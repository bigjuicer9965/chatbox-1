"use client";

import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: string;
};

type SavedChatState = {
  conversations: Conversation[];
  activeConversationId: string | null;
};

const STORAGE_KEY = "kindred-conversations";
const STORAGE_CHANGE_EVENT = "kindred-storage-change";
const STREAM_UPDATE_INTERVAL = 48;
const EMPTY_MESSAGES: Message[] = [];
const EMPTY_SAVED_CHAT_STATE: SavedChatState = {
  conversations: [],
  activeConversationId: null,
};
const EMPTY_SAVED_CHAT_STATE_JSON = JSON.stringify(EMPTY_SAVED_CHAT_STATE);
const STORAGE_UNAVAILABLE_PREFIX = "__kindred_storage_unavailable__:";
let memorySnapshot = EMPTY_SAVED_CHAT_STATE_JSON;

function subscribeToSavedChats(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(STORAGE_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(STORAGE_CHANGE_EVENT, onChange);
  };
}

function getSavedChatsSnapshot() {
  try {
    const serialized = window.localStorage.getItem(STORAGE_KEY);
    if (serialized !== null) {
      memorySnapshot = serialized;
      return serialized;
    }
    return EMPTY_SAVED_CHAT_STATE_JSON;
  } catch {
    return `${STORAGE_UNAVAILABLE_PREFIX}${memorySnapshot}`;
  }
}

function getServerSavedChatsSnapshot() {
  return EMPTY_SAVED_CHAT_STATE_JSON;
}

function isMessage(value: unknown): value is Message {
  if (typeof value !== "object" || value === null || !("role" in value) || !("content" in value)) {
    return false;
  }

  return (
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string"
  );
}

function isConversation(value: unknown): value is Conversation {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    !("title" in value) ||
    !("messages" in value) ||
    !("updatedAt" in value)
  ) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    Array.isArray(value.messages) &&
    value.messages.every(isMessage) &&
    typeof value.updatedAt === "string"
  );
}

function isSavedChatState(value: unknown): value is SavedChatState {
  if (
    typeof value !== "object" ||
    value === null ||
    !("conversations" in value) ||
    !("activeConversationId" in value)
  ) {
    return false;
  }

  return (
    Array.isArray(value.conversations) &&
    value.conversations.every(isConversation) &&
    (typeof value.activeConversationId === "string" || value.activeConversationId === null)
  );
}

function parseSavedChatState(serialized: string) {
  const storageUnavailable = serialized.startsWith(STORAGE_UNAVAILABLE_PREFIX);
  const value = storageUnavailable
    ? serialized.slice(STORAGE_UNAVAILABLE_PREFIX.length)
    : serialized;

  try {
    const saved: unknown = JSON.parse(value);
    if (!isSavedChatState(saved)) {
      throw new Error("Saved conversation data has an invalid format.");
    }

    return {
      state: {
        ...saved,
        activeConversationId: saved.conversations.some(
          (conversation) => conversation.id === saved.activeConversationId,
        )
          ? saved.activeConversationId
          : null,
      },
      error: storageUnavailable
        ? "Browser storage is unavailable. Conversations will only remain available in this tab."
        : "",
    };
  } catch (loadError) {
    console.error("Could not load saved conversations:", loadError);
    return {
      state: EMPTY_SAVED_CHAT_STATE,
      error: "Saved conversations could not be loaded. Your next sent message will replace the damaged local history.",
    };
  }
}

const suggestions = [
  {
    title: "Make sense of something",
    detail: "Break down a tricky idea",
    prompt: "Explain a tricky idea simply",
    icon: "01",
  },
  {
    title: "Find the right words",
    detail: "Shape a note, draft, or reply",
    prompt: "Help me write something",
    icon: "02",
  },
  {
    title: "Start somewhere",
    detail: "Turn a loose thought into a plan",
    prompt: "Brainstorm a new project",
    icon: "03",
  },
];

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 2 1.8 7.2L21 11l-7.2 1.8L12 20l-1.8-7.2L3 11l7.2-1.8L12 2Z" />
      <path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 19V5m-6 6 6-6 6 6" />
    </svg>
  );
}

export default function Home() {
  const serializedSavedState = useSyncExternalStore(
    subscribeToSavedChats,
    getSavedChatsSnapshot,
    getServerSavedChatsSnapshot,
  );
  const parsedSavedState = useMemo(
    () => parseSavedChatState(serializedSavedState),
    [serializedSavedState],
  );
  const { conversations, activeConversationId } = parsedSavedState.state;
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState("");
  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const visibleStorageError = storageError || parsedSavedState.error;
  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  );
  const messages = activeConversation?.messages ?? EMPTY_MESSAGES;

  useEffect(() => {
    const messageList = endOfMessagesRef.current?.parentElement;
    if (isSending && messageList) {
      messageList.scrollTop = messageList.scrollHeight;
      return;
    }
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  const saveChatState = useCallback((nextState: SavedChatState) => {
    const serialized = JSON.stringify(nextState);
    try {
      window.localStorage.setItem(STORAGE_KEY, serialized);
      memorySnapshot = serialized;
      setStorageError("");
    } catch (saveError) {
      console.error("Could not save conversations:", saveError);
      memorySnapshot = serialized;
      setStorageError("Conversations could not be saved. They will only remain available in this tab.");
    }
    window.dispatchEvent(new Event(STORAGE_CHANGE_EVENT));
  }, []);

  const selectConversation = useCallback((id: string | null) => {
    saveChatState({
      ...parseSavedChatState(getSavedChatsSnapshot()).state,
      activeConversationId: id,
    });
  }, [saveChatState]);

  const updateConversation = useCallback((id: string, title: string, nextMessages: Message[]) => {
    const current = parseSavedChatState(getSavedChatsSnapshot()).state;
    const updatedConversation: Conversation = {
      id,
      title,
      messages: nextMessages,
      updatedAt: new Date().toISOString(),
    };
    saveChatState({
      ...current,
      activeConversationId: id,
      conversations: [
        updatedConversation,
        ...current.conversations.filter((conversation) => conversation.id !== id),
      ],
    });
  }, [saveChatState]);

  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (isSending) return;
        selectConversation(null);
        setError("");
        setInput("");
        textareaRef.current?.focus();
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [isSending, selectConversation]);

  async function sendMessage(text: string, retry = false) {
    const content = text.trim();
    if (!content || isSending) return;

    const userMessage: Message = { role: "user", content };
    const conversationId = activeConversationId ?? crypto.randomUUID();
    const conversationTitle =
      activeConversation?.title ?? content.slice(0, 60);
    const conversation = retry ? messages : [...messages, userMessage];
    if (!retry) {
      updateConversation(conversationId, conversationTitle, conversation);
    }
    setInput("");
    setError("");
    setIsSending(true);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

    let assistantContent = "";
    let updateTimer: ReturnType<typeof setTimeout> | undefined;
    const flushAssistantUpdate = () => {
      if (updateTimer !== undefined) {
        clearTimeout(updateTimer);
        updateTimer = undefined;
      }
      if (!assistantContent) return;
      updateConversation(conversationId, conversationTitle, [
        ...conversation,
        { role: "assistant", content: assistantContent },
      ]);
    };

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ messages: conversation }),
      });

      if (!response.ok) {
        const data: { error?: string } = await response.json();
        throw new Error(data.error || "The request could not be completed.");
      }
      if (!response.body) {
        throw new Error("The response stream could not be opened. Please try again.");
      }

      const conversationWithAssistant = [
        ...conversation,
        { role: "assistant" as const, content: "" },
      ];
      updateConversation(conversationId, conversationTitle, conversationWithAssistant);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamCompleted = false;

      function handleEvent(event: string) {
        const dataLine = event.split("\n").find((line) => line.startsWith("data: "));
        if (!dataLine) return;

        const data: { token?: string; error?: string; done?: boolean } = JSON.parse(
          dataLine.slice(6),
        );
        if (data.error) throw new Error(data.error);
        if (data.done) streamCompleted = true;
        if (data.token) {
          assistantContent += data.token;
          if (updateTimer === undefined) {
            updateTimer = setTimeout(flushAssistantUpdate, STREAM_UPDATE_INTERVAL);
          }
        }
      }

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          handleEvent(event);
        }

        if (done) break;
      }

      if (buffer.trim()) handleEvent(buffer);
      if (!streamCompleted) {
        throw new Error("The connection ended before the reply was complete. Please try again.");
      }
      flushAssistantUpdate();

      if (!assistantContent) {
        updateConversation(conversationId, conversationTitle, conversation);
      }
    } catch (sendError) {
      if (updateTimer !== undefined) {
        clearTimeout(updateTimer);
        updateTimer = undefined;
      }
      updateConversation(conversationId, conversationTitle, conversation);
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  }

  function startNewChat() {
    if (isSending) return;
    selectConversation(null);
    setError("");
    setInput("");
    textareaRef.current?.focus();
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Kindred home">
          <span className="brand-mark">
            <SparkIcon />
          </span>
          <span>kindred</span>
        </Link>

        <button className="new-chat-button" disabled={isSending} onClick={startNewChat} type="button">
          <span className="new-chat-plus">+</span>
          New conversation
          <kbd>⌘ K</kbd>
        </button>

        <div className="sidebar-section">
          <p className="sidebar-label">CONVERSATIONS</p>
          {conversations.length ? (
            <div className="conversation-history">
              {conversations.map((conversation) => (
                <button
                  aria-current={conversation.id === activeConversationId ? "true" : undefined}
                  className="conversation-history-item"
                  disabled={isSending}
                  key={conversation.id}
                  onClick={() => {
                    selectConversation(conversation.id);
                    setError("");
                    setInput("");
                  }}
                  type="button"
                >
                  {conversation.title}
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-history">
              <span className="history-line" />
              <p>Your conversations<br />will appear here.</p>
            </div>
          )}
          {visibleStorageError ? <p className="storage-notice" role="status">{visibleStorageError}</p> : null}
        </div>

        <div className="sidebar-bottom">
          <div className="model-indicator">
            <span className="status-dot" />
            <span className="model-copy">
              <span className="model-label">CURRENT MODEL</span>
              <span className="model-name">Google AI Studio</span>
            </span>
          </div>
          <p className="sidebar-caption">A calm corner for questions, drafts, and ideas.</p>
        </div>
      </aside>

      <section className="chat-panel">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark"><SparkIcon /></span>
            <span>kindred</span>
          </div>
          <div className="conversation-title">
            <span>{activeConversation?.title || "New conversation"}</span>
          </div>
          <button
            className="topbar-new-chat"
            disabled={isSending}
            onClick={startNewChat}
            type="button"
            aria-label="Start a new conversation"
          >
            <span>+</span>
          </button>
          <span className="topbar-note">A little space to think</span>
        </header>

        <div className="conversation">
          {messages.length === 0 ? (
            <div className="welcome">
              <p className="eyebrow">A MOMENT FOR WHAT MATTERS</p>
              <h1>Where would you<br />like to <em>begin?</em></h1>
              <p className="welcome-description">
                A question, a passing thought, the thing you&apos;ve been meaning
                to figure out. Start anywhere.
              </p>
              <div className="suggestions">
                {suggestions.map((suggestion) => (
                  <button
                    className="suggestion"
                    key={suggestion.title}
                    onClick={() => void sendMessage(suggestion.prompt)}
                    type="button"
                  >
                    <span className="suggestion-index">{suggestion.icon}</span>
                    <span className="suggestion-copy">
                      <span className="suggestion-title">{suggestion.title}</span>
                      <span className="suggestion-detail">{suggestion.detail}</span>
                    </span>
                    <span className="suggestion-arrow" aria-hidden="true">↗</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-list" aria-live="polite">
              {messages.map((message, index) => {
                const isStreamingMessage =
                  isSending && index === messages.length - 1 && message.role === "assistant";
                return (
                  <article className={`message message-${message.role}`} key={`${index}-${message.role}`}>
                    {message.role === "assistant" ? (
                      <span className="message-avatar"><SparkIcon /></span>
                    ) : null}
                    <div className="message-content">
                      <span className="message-author">
                        {message.role === "assistant" ? "Kindred" : "You"}
                      </span>
                      {message.role === "assistant" ? (
                        isStreamingMessage && !message.content ? (
                          <div className="typing-indicator" aria-label="Kindred is thinking">
                            <span /><span /><span />
                          </div>
                        ) : (
                          <div className={`markdown-content${isStreamingMessage ? " streaming-content" : ""}`}>
                            {isStreamingMessage ? (
                              <>
                                <span className="streaming-text">{message.content}</span>
                                <span className="streaming-cursor" aria-hidden="true" />
                              </>
                            ) : (
                              <ReactMarkdown>{message.content}</ReactMarkdown>
                            )}
                          </div>
                        )
                      ) : (
                        <p>{message.content}</p>
                      )}
                    </div>
                    {message.role === "user" ? <span className="user-message-avatar">Y</span> : null}
                  </article>
                );
              })}
              {error ? (
                <div className="error-message" role="alert">
                  <span>{error}</span>
                  <button onClick={() => void sendMessage(messages[messages.length - 1]?.content ?? "", true)} type="button">
                    Try again
                  </button>
                </div>
              ) : null}
              <div ref={endOfMessagesRef} />
            </div>
          )}
        </div>

        <div className="composer-area">
          <form className="composer" onSubmit={handleSubmit}>
            <textarea
              aria-label="Message Kindred"
              onChange={(event) => {
                setInput(event.target.value);
                setError("");
                event.target.style.height = "auto";
                event.target.style.height = `${Math.min(event.target.scrollHeight, 180)}px`;
              }}
              onKeyDown={handleKeyDown}
              placeholder="Ask anything, or just start writing..."
              ref={textareaRef}
              rows={1}
              value={input}
            />
            <div className="composer-toolbar">
              <span className="composer-hint"><kbd>↵</kbd> to send <span>·</span> <kbd>⇧ ↵</kbd> for a new line</span>
              <button
                aria-label="Send message"
                className="send-button"
                disabled={!input.trim() || isSending}
                type="submit"
              >
                <ArrowIcon />
              </button>
            </div>
          </form>
          <p className="disclaimer">Kindred can make mistakes. Trust your judgment on important things.</p>
        </div>
      </section>
    </main>
  );
}
