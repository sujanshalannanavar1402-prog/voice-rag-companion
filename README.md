# Voice RAG Companion

Build a simple voice-enabled RAG demo app called "Voice RAG MVP". Use Supabase (connected) for database and edge functions.

DATABASE:

Create one table `chunks`: id (uuid pk), text (text), embedding (vector(1536)), source_doc_id (text), created_at (timestamptz default now()). Enable pgvector, add a basic index on embedding.

Also create `latency_logs`: id (uuid pk), query_text (text), total_ms (numeric), stt_ms (numeric), retrieval_ms (numeric), generation_ms (numeric), created_at (timestamptz default now()).

EDGE FUNCTION 1 - ingest-corpus:

This function loads real data from the ai4bharat/MSMARCO-XI dataset on Hugging Face and populates the `chunks` table. Steps:

1. Fetch rows using the Hugging Face datasets-server REST API:

   GET https://datasets-server.huggingface.co/rows?dataset=ai4bharat/MSMARCO-XI&config=default&split=train&offset=0&length=100

   (this returns JSON rows directly, no need for the python datasets library)

2. Extract the text/passage field from each row (inspect the returned JSON structure first and use whichever field holds the passage text)

3. Split each passage into chunks of ~200 words with 30-word overlap

4. Generate an embedding for each chunk using an embeddings API (key stored in secret EMBEDDING_API_KEY)

5. Insert each chunk into the `chunks` table with its embedding and source_doc_id (use the row's id/index from the dataset)

6. Wrap the Hugging Face fetch and embedding calls in try/catch with 1 retry on failure

7. Return a summary: { rows_fetched, chunks_created, errors }

This should be triggered manually via a button in the UI, not run automatically on page load.

EDGE FUNCTION 2 - speech-to-text:

Accepts base64 audio, calls Sarvam AI STT API using secret SARVAM_API_KEY, returns { transcript }. Wrap in try/catch, return a structured error on failure, no unhandled exceptions.

EDGE FUNCTION 3 - rag-answer:

Accepts { query }. Steps, each timed:

1. Embed the query

2. Vector similarity search top-5 chunks from `chunks` table (cosine)

3. Call an LLM with system prompt: "Answer only using the provided context. If the answer isn't in the context, say 'I don't have enough information to answer that.'"

4. Log stt_ms (pass through from frontend), retrieval_ms, generation_ms, total_ms into latency_logs

5. Return { answer, sources: [chunk texts used], latency: {...} }

Wrap all external calls in try/catch with one retry on failure.

FRONTEND:

One page with two sections:

1. A "Load Data" button (top of page) that calls ingest-corpus and shows a status message like "Loaded X chunks" when done. Only needs to be clicked once.

2. Below that: a mic button that records audio -> calls speech-to-text -> shows transcript -> auto-calls rag-answer -> shows the answer + a small latency number (total_ms) under it.

Keep it minimal, no extra pages. Simple clean Tailwind UI.

Do not add guardrails, multiple chunking strategies, or an analytics page yet — this is a bare-bones working version I will extend later.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/1effc80d-0e05-497b-b7a9-1a513aed324c).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
