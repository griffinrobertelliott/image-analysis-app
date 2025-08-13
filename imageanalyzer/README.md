# Image Analyzer

Simple Next.js app to analyze a JPG with a prompt using an Anthropic model via the Messages API.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local` in the project root:

```bash
ANTHROPIC_API_KEY=YOUR_KEY_HERE
# Optional model override
ANTHROPIC_MODEL=claude-sonnet-4-20250514
# Optional: comma-separated absolute paths to PDFs to index as context
# If not set, will look for documents in ../documents/ directory
DOC_PATHS=/absolute/path/to/doc1.pdf,/absolute/path/to/doc2.pdf
```

3. Run the app:

```bash
npm run dev
```

Open http://localhost:3000

## Notes
- Only JPG images are accepted.
- Your API key is used server-side only via the API route.
- If `DOC_PATHS` is not set, the server will try to index PDFs from the `../documents/` directory.
- The `documents/` directory is included in git so the reference materials are available when deploying.
This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
