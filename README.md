## Galaxy Chat – Auth + MongoDB Setup

### Prerequisites
- Node 18+
- Clerk account
- MongoDB Atlas database
- Openrouter 

### Environment Variables (.env.local)
Create `.env.local` in the project root:

```bash
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# MongoDB
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster0.mongodb.net/
MONGODB_DB=galaxy_chat

# Openrouter
OPENROUTER_API_KEY=sk...

# Cloudinary (for image uploads)
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret

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
- `app/(auth)/sign-in/[[...sign-in]]/page.tsx` - Clerk sign-in page
- `app/(auth)/sign-up/[[...sign-up]]/page.tsx` - Clerk sign-up page
- `app/(chat)/page.tsx` - Main chat interface
- `lib/database/db.ts` - MongoDB connection management
- `lib/database/models/user-profile.ts` - User profile schema
- `lib/actions/auth/user.ts` - User profile CRUD operations
- `lib/mappers/user.ts` - User data transformation utilities
- `middleware.ts` - Auth middleware and route protection
- `app/layout.tsx` - Root layout with ClerkProvider