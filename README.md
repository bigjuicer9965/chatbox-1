# Kindred Chat

A small chat app built with Next.js, LangChain, and the Google Gemini API.

## Getting started

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env`.
3. Set `GOOGLE_API_KEY` in `.env` to a key from [Google AI Studio](https://aistudio.google.com/app/apikey).
4. Run `npm run dev` and open [http://localhost:3000](http://localhost:3000).

The app calls Google directly through LangChain's `@langchain/google` integration. It uses `gemini-3.8-flash` by default; set `GOOGLE_MODEL` in `.env` to select another model available to your Google AI Studio key.

The API key is only read by the server-side route and is never sent to the browser. Chat history currently lives in the page state and is cleared when you start a new conversation or refresh the page.
