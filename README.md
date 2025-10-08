# Galaxy Chat 🚀

A modern, AI-powered chat application built with Next.js, featuring persistent memory, file uploads, and a ChatGPT-like interface. Galaxy Chat provides an intelligent conversational experience with support for multiple AI models, conversation history, and seamless user authentication.

## ✨ Features

- 🤖 **AI Chat Interface** - ChatGPT-like UI with streaming responses
- 🧠 **Persistent Memory** - Conversation context using Mem0
- 📁 **File Uploads** - Support for images and documents via Cloudinary
- 🔐 **Authentication** - Secure user management with Clerk
- 💾 **Data Persistence** - MongoDB for chat history and user profiles
- 🎨 **Modern UI** - Built with Radix UI and Tailwind CSS
- 📱 **Responsive Design** - Mobile-first approach
- ⚡ **Real-time Streaming** - Vercel AI SDK for smooth chat experience
- 🔄 **Message Editing** - Edit and regenerate responses
- 📚 **Chat Library** - Browse and manage conversation history

## 🛠️ Tech Stack

### Frontend
- **Framework**: Next.js 15.5.4 (App Router)
- **Language**: TypeScript
- **UI Library**: Radix UI + ShadCN
- **Styling**: Tailwind CSS 4
- **Icons**: Lucide React
- **Animations**: Framer Motion
- **Forms**: React Hook Form + Zod validation

### Backend
- **Runtime**: Node.js 18+
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: Clerk
- **File Storage**: Cloudinary
- **AI Integration**: Vercel AI SDK + OpenRouter
- **Memory**: Mem0 for conversation persistence

### Development Tools
- **Linting**: Biome
- **Type Checking**: TypeScript
- **Package Manager**: npm

## 📁 Project Structure

```
galaxy-chat/
├── app/                          # Next.js App Router
│   ├── (auth)/                   # Authentication routes
│   │   ├── forgot-password/      # Password reset
│   │   ├── sign-in/              # Sign in page
│   │   └── sign-up/              # Sign up page
│   ├── (chat)/                   # Protected chat routes
│   │   ├── api/                  # API routes
│   │   │   ├── chat/             # Chat API endpoints
│   │   │   ├── history/          # Chat history API
│   │   │   ├── library/          # Library management API
│   │   │   └── upload/           # File upload API
│   │   ├── chat/                 # Chat interface
│   │   │   ├── [id]/             # Individual chat pages
│   │   │   └── library/          # Chat library
│   │   └── action.ts             # Server actions
│   ├── globals.css               # Global styles
│   └── layout.tsx                # Root layout
├── components/                   # React components
│   ├── auth/                     # Authentication components
│   ├── chat/                     # Chat-related components
│   │   └── message/              # Message components
│   ├── elements/                 # UI elements
│   ├── home/                     # Homepage components
│   ├── library/                  # Library components
│   ├── sidebar/                  # Sidebar components
│   ├── svg/                      # SVG icons
│   └── ui/                       # Reusable UI components
├── hooks/                        # Custom React hooks
├── lib/                          # Utility libraries
│   ├── actions/                  # Server actions
│   │   ├── auth/                 # Authentication actions
│   │   ├── chat/                 # Chat actions
│   │   └── mem0/                 # Memory actions
│   ├── ai/                       # AI-related utilities
│   ├── database/                 # Database configuration
│   │   └── models/               # Mongoose models
│   ├── mappers/                  # Data transformation
│   ├── schema/                   # Zod schemas
│   └── types/                    # TypeScript types
├── public/                       # Static assets
├── middleware.ts                 # Next.js middleware
└── package.json                  # Dependencies
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18 or higher
- MongoDB Atlas account
- Clerk account
- OpenRouter/AI GATEWAY API key
- Cloudinary account
- Mem0 account

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd galaxy-chat
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Create a `.env.local` file in the project root:
   ```bash
   # Clerk Authentication
   NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
   CLERK_SECRET_KEY=sk_test_...

   # MongoDB Database
   MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/
   MONGODB_DB=galaxy_chat

   # OpenRouter/AI GATEWAY
   AI_GATEWAY_API_KEY=vck...
   OPENROUTER_API_KEY=sk...

   # Cloudinary File Storage
   CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
   CLOUDINARY_API_KEY=your_cloudinary_api_key
   CLOUDINARY_API_SECRET=your_cloudinary_api_secret

   # Mem0
   MEM0_API_KEY=m0...
   ```

4. **Run the development server**
   ```bash
   npm run dev
   ```

5. **Open your browser**
   
   Navigate to [http://localhost:3000](http://localhost:3000)

## 🔧 Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run Biome linter
- `npm run format` - Format code with Biome

## 🗄️ Database Schema

### Chat Model
```typescript
{
  id: string;           // Unique chat identifier
  title: string;        // Chat title
  userId: string;       // Clerk user ID
  visibility: 'public' | 'private';
  lastContext: AppUsage | null;
  createdAt: Date;
  updatedAt: Date;
}
```

### User Profile Model
```typescript
{
  userId: string;       // Clerk user ID
  email: string;        // User email
  name?: string;        // Display name
  imageUrl?: string;    // Profile image
  createdAt: Date;
  updatedAt: Date;
}
```

### Chat Message Model
```typescript
{
  id: string;           // Unique message ID
  chatId: string;       // Parent chat ID
  role: 'user' | 'assistant';
  content: string;      // Message content
  attachments?: Attachment[];
  createdAt: Date;
  updatedAt: Date;
}
```

## 🔐 Authentication Flow

1. **Public Routes**: `/`, `/sign-in`, `/sign-up`, `/forgot-password`
2. **Protected Routes**: All `/chat/*` routes require authentication
3. **Middleware**: Automatic redirects based on auth state
4. **User Profiles**: Automatically created on first login

## 🤖 AI Integration

- **Models**: Support for multiple AI models via OpenRouter
- **Streaming**: Real-time response streaming
- **Memory**: Persistent conversation context with Mem0
- **File Support**: Image and document analysis
- **Context Management**: Automatic context window management

## 📁 File Upload

- **Supported Formats**: Images (PNG, JPG, WebP), Documents (PDF, DOCX, TXT)
- **Storage**: Cloudinary integration
- **Processing**: Automatic file optimization and transformation
- **Security**: File type validation and size limits

## 🎨 UI Components

Built with Radix UI primitives and styled with Tailwind CSS:
- Accessible by default
- Keyboard navigation support
- Responsive design
- Dark/light theme support
- Custom animations with Framer Motion

## 🚀 Deployment

### Vercel (Recommended)

1. Push your code to GitHub
2. Connect your repository to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy automatically on every push

### Environment Variables for Production

Ensure all environment variables are set in your deployment platform:
- Clerk keys (production)
- MongoDB URI
- OpenRouter API key
- Cloudinary credentials

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## 🆘 Support

For support and questions:
- Create an issue in the repository
- Check the documentation
- Review the codebase structure

---

Built with ❤️ using Next.js, TypeScript, and modern web technologies.