const prisma = require('../lib/prisma');
const HttpError = require('../utils/httpError');
const { streamChat } = require('../services/openrouterService');
const logger = require('../utils/logger');

const SYSTEM_PROMPT =
  'You are DevForge AI, an expert software engineering assistant inside an AI software engineering platform. ' +
  'You help users design, plan, build, debug and reason about full-stack applications. ' +
  'Be precise and practical. When relevant, include runnable code samples, step-by-step guidance, ' +
  'architecture advice and trade-off analysis. Prefer concise, well-structured Markdown answers.';

// Only the most recent messages are sent to the model to stay within context limits.
const CONTEXT_WINDOW = 60;

const DEFAULT_TITLE = 'New conversation';

function serializeConversation(c) {
  return {
    id: c.id,
    title: c.title,
    messageCount: c._count ? c._count.messages : undefined,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function serializeMessage(m) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt,
  };
}

async function getOwnedConversation(id, userId) {
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId },
    include: { _count: { select: { messages: true } } },
  });
  if (!conversation) throw new HttpError(404, 'Conversation not found');
  return conversation;
}

async function listConversations(req, res) {
  const conversations = await prisma.conversation.findMany({
    where: { userId: req.userId },
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { messages: true } } },
    take: 100,
  });
  res.json({ conversations: conversations.map(serializeConversation) });
}

async function createConversation(req, res) {
  const { title } = req.body || {};
  const conversation = await prisma.conversation.create({
    data: {
      userId: req.userId,
      title: title && title.trim() ? title.trim().slice(0, 80) : DEFAULT_TITLE,
    },
  });
  res.status(201).json({ conversation: serializeConversation(conversation) });
}

async function getConversation(req, res) {
  const { id } = req.params;
  await getOwnedConversation(id, req.userId);

  const messages = await prisma.chatMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: 'asc' },
  });

  const conversation = await prisma.conversation.findUnique({
    where: { id },
    include: { _count: { select: { messages: true } } },
  });

  res.json({ conversation: serializeConversation(conversation), messages: messages.map(serializeMessage) });
}

async function renameConversation(req, res) {
  const { id } = req.params;
  await getOwnedConversation(id, req.userId);

  const { title } = req.body || {};
  if (!title || typeof title !== 'string' || !title.trim()) {
    throw new HttpError(400, 'Title is required');
  }

  const updated = await prisma.conversation.update({
    where: { id },
    data: { title: title.trim().slice(0, 80) },
  });
  res.json({ conversation: serializeConversation(updated) });
}

async function deleteConversation(req, res) {
  const { id } = req.params;
  await getOwnedConversation(id, req.userId);
  await prisma.conversation.delete({ where: { id } });
  res.json({ ok: true });
}

/**
 * Streams an assistant reply via Server-Sent Events.
 * Event payloads:
 *   data: {"delta":"..."}          – a partial token
 *   data: {"done":true,"message":{...}} – completion (assistant message persisted)
 *   data: {"error":"..."}          – fatal error
 */
async function sendMessage(req, res) {
  const { id } = req.params;
  const { content } = req.body || {};

  const conversation = await getOwnedConversation(id, req.userId);

  const userMessage = await prisma.chatMessage.create({
    data: { conversationId: id, role: 'user', content },
  });

  // Derive a title from the first user message.
  if (conversation.title === DEFAULT_TITLE) {
    const derived = content.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (derived) {
      await prisma.conversation
        .update({ where: { id }, data: { title: derived } })
        .catch(() => {});
    }
  }

  const recentMessages = await prisma.chatMessage.findMany({
    where: { conversationId: id },
    orderBy: { createdAt: 'desc' },
    take: CONTEXT_WINDOW,
  });
  const history = recentMessages.reverse();

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })),
  ];

  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  let clientGone = false;
  const abortController = new AbortController();
  req.on('close', () => {
    clientGone = true;
    abortController.abort();
  });

  const sendEvent = (payload) => {
    if (clientGone || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  let fullText = '';

  try {
    for await (const chunk of streamChat({ messages, signal: abortController.signal })) {
      if (chunk.delta) {
        fullText += chunk.delta;
        sendEvent({ delta: chunk.delta });
      } else if (chunk.done) {
        fullText = chunk.content;
      }
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      // Client disconnected (Stop button / closed tab). Persist what was generated.
      if (fullText.trim()) {
        await prisma.chatMessage
          .create({ data: { conversationId: id, role: 'assistant', content: fullText.trim() } })
          .catch(() => {});
        await prisma.conversation
          .update({ where: { id }, data: { updatedAt: new Date() } })
          .catch(() => {});
      }
      return res.end();
    }
    logger.error(`[Chat] stream failed for conversation ${id}: ${err.message}`);
    sendEvent({ error: err.message || 'Failed to generate a response' });
    // Persist whatever partial answer was produced before the failure.
    if (fullText.trim()) {
      await prisma.chatMessage
        .create({ data: { conversationId: id, role: 'assistant', content: fullText.trim() } })
        .catch(() => {});
      await prisma.conversation
        .update({ where: { id }, data: { updatedAt: new Date() } })
        .catch(() => {});
    }
    return res.end();
  }

  if (!fullText.trim()) {
    const message = 'The model returned an empty response. Please try again.';
    sendEvent({ error: message });
    return res.end();
  }

  let assistantMessage = null;
  try {
    assistantMessage = await prisma.chatMessage.create({
      data: { conversationId: id, role: 'assistant', content: fullText.trim() },
    });
    await prisma.conversation.update({ where: { id }, data: { updatedAt: new Date() } }).catch(() => {});
  } catch (err) {
    // The conversation may have been deleted while the stream was running.
    logger.warn(`[Chat] failed to persist assistant message for ${id}: ${err.message}`);
  }

  if (assistantMessage) {
    sendEvent({ done: true, message: serializeMessage(assistantMessage) });
  }
  res.end();
}

module.exports = {
  listConversations,
  createConversation,
  getConversation,
  renameConversation,
  deleteConversation,
  sendMessage,
};
