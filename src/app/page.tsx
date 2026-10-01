"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

type Message = {
  role: "user" | "assistant";
  content: string;
};

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  useEffect(() => {
    function handleShortcut(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setMessages([]);
        setError("");
        setInput("");
        textareaRef.current?.focus();
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  async function sendMessage(text: string, retry = false) {
    const content = text.trim();
    if (!content || isSending) return;

    const userMessage: Message = { role: "user", content };
    const conversation = retry ? messages : [...messages, userMessage];
    if (!retry) setMessages(conversation);
    setInput("");
    setError("");
    setIsSending(true);
    if (textareaRef.current) textareaRef.current.style.height = "auto";

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

      const assistantIndex = conversation.length;
      setMessages([...conversation, { role: "assistant", content: "" }]);

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
          setMessages((current) =>
            current[assistantIndex]?.role === "assistant"
              ? current.map((message, index) =>
                  index === assistantIndex
                    ? { ...message, content: message.content + data.token }
                    : message,
                )
              : current,
          );
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

      setMessages((current) =>
        current.filter(
          (message, index) =>
            index !== assistantIndex || (message.role === "assistant" && message.content.length > 0),
        ),
      );
    } catch (sendError) {
      setMessages((current) =>
        current.filter(
          (message, index) => index !== conversation.length || message.role !== "assistant",
        ),
      );
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
    setMessages([]);
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

        <button className="new-chat-button" onClick={startNewChat} type="button">
          <span className="new-chat-plus">+</span>
          New conversation
          <kbd>⌘ K</kbd>
        </button>

        <div className="sidebar-section">
          <p className="sidebar-label">CONVERSATIONS</p>
          <div className="empty-history">
            <span className="history-line" />
            <p>Conversations aren&apos;t<br />saved yet.</p>
          </div>
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
            <span>{messages[0]?.content.slice(0, 42) || "New conversation"}{messages[0]?.content.length && messages[0].content.length > 42 ? "…" : ""}</span>
          </div>
          <button
            className="topbar-new-chat"
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
              {messages.map((message, index) => (
                <article className={`message message-${message.role}`} key={`${index}-${message.role}`}>
                  {message.role === "assistant" ? (
                    <span className="message-avatar"><SparkIcon /></span>
                  ) : null}
                  <div className="message-content">
                    <span className="message-author">
                      {message.role === "assistant" ? "Kindred" : "You"}
                    </span>
                    {message.role === "assistant" ? (
                      <div className="markdown-content"><ReactMarkdown>{message.content}</ReactMarkdown></div>
                    ) : (
                      <p>{message.content}</p>
                    )}
                  </div>
                  {message.role === "user" ? <span className="user-message-avatar">Y</span> : null}
                </article>
              ))}
              {isSending ? (
                <article className="message message-assistant">
                  <span className="message-avatar"><SparkIcon /></span>
                  <div className="message-content">
                    <span className="message-author">Kindred</span>
                    <div className="typing-indicator" aria-label="Kindred is thinking">
                      <span /><span /><span />
                    </div>
                  </div>
                </article>
              ) : null}
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
