# KAYO Frontend

Next.js 14 dashboard for KAYO security platform.

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- React Query (TanStack Query)
- Zustand (state management)
- React Hook Form + Zod (form validation)
- Axios (API client)

## Getting Started

1. Install dependencies:
```bash
npm install
```

2. Set environment variables:
```bash
NEXT_PUBLIC_API_URL=http://localhost:8000
```

3. Run development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000)

## Features

- Authentication (JWT)
- Dashboard overview
- Incident management
- Deployment management
- Team member invitations
- Webhook integrations
- Real-time updates

## Project Structure

```
frontend/
├── app/
│   ├── dashboard/          # Dashboard pages
│   │   ├── incidents/      # Incident views
│   │   ├── deployments/    # Deployment views
│   │   └── settings/       # Settings pages
│   ├── login/              # Login page
│   ├── layout.tsx          # Root layout
│   ├── page.tsx            # Home (redirects to login)
│   ├── providers.tsx       # React Query provider
│   └── globals.css         # Global styles
├── lib/
│   ├── api-client.ts       # API client
│   ├── auth-store.ts       # Auth state management
│   └── utils.ts            # Utility functions
├── package.json
├── tsconfig.json
├── tailwind.config.ts
└── next.config.js
```

## API Integration

The frontend connects to the KAYO control plane API at `http://localhost:8000`.

All API calls are authenticated using JWT tokens stored in localStorage.

## Build

```bash
npm run build
npm start
```

## Type Checking

```bash
npm run type-check
```
