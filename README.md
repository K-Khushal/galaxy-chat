## Galaxy Chat – Auth + MongoDB Setup

### Prerequisites
- Node 18+
- Clerk account
- MongoDB Atlas database

### Environment Variables (.env.local)
Create `.env.local` in the project root:

```bash
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# MongoDB
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster0.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=galaxy_chat
```

### Install
```bash
npm install
```

### Develop
```bash
npm run dev
```
Visit `http://localhost:3000`.

### Auth Flow
- Public routes: `/`, `/sign-in`, `/sign-up`, `/forgot-password`
- Protected route: `/dashboard` (middleware enforces auth)

### Files of Interest
- `app/sign-in/[[...sign-in]]/page.tsx`
- `app/sign-up/[[...sign-up]]/page.tsx`
- `app/forgot-password/[[...forgot-password]]/page.tsx`
- `app/dashboard/page.tsx`
- `lib/mongodb.ts` – shared MongoDB connection
- `lib/user.ts` – user profile helpers
- `middleware.ts` – route protection
- `app/layout.tsx` – Navbar + ClerkProvider

### Notes
- `UserButton` includes sign-out with `afterSignOutUrl="/"`.
- Dashboard demonstrates mixing Clerk user data with MongoDB profile.
