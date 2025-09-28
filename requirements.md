# Requirements.md  

## 📌 Project Overview  
This project is a **ChatGPT Clone** built with modern, scalable technologies. The goal is to achieve **feature parity with ChatGPT**, while maintaining strict engineering standards, production readiness, and seamless backend integration.

---

## 🚀 Philosophy & Development Approach  
- **Lean & Efficient:** Avoid unnecessary processes, bureaucracy, and micromanagement.  
- **Autonomy & Ownership:** Developers are expected to work independently, ask smart questions, and own their contributions.  
- **Excellence:** Only high-quality, maintainable, and modular code will be accepted. Submissions failing guidelines will be rejected.  

---

## 🛠️ Required Tech Stack  
All submissions **must** use the following stack:

- **Framework:** Next.js (with best practices applied)  
- **Language:** TypeScript (preferred) or JavaScript  
- **UI/UX:**  
  - v0.dev (AI-powered UI/UX generation)  
  - TailwindCSS (styling)  
  - ShadCN (components)  
- **Database:** MongoDB  
- **Auth:** Clerk (authentication & authorization)  
- **File Storage:** Cloudinary  
- **Editor:** Cursor IDE (AI-powered coding)  
- **Deployment:** Vercel  

---

## 🎨 Functional Requirements  

### Chat Interface (UI/UX)  
- Pixel-perfect clone of ChatGPT’s UI (fonts, spacing, scrolling, modals, animations).  
- Fully mobile-responsive and ARIA-compliant (accessible).  
- Users must be able to **edit messages** and regenerate responses seamlessly.  

### Chat Functionality  
- **Vercel AI SDK** integration for handling responses.  
- Support for **message streaming** with smooth UI updates.  
- Logic for handling **context windows** (e.g., trimming historical messages).  

### Memory & Context  
- Must integrate **mem0** for persistent conversation memory.  

### File & Image Support  
- Upload images (PNG, JPG, etc.) and documents (PDF, DOCX, TXT, etc.).  

---

## ⚙️ Backend Requirements  
- **Framework:** Next.js  
- **Database:** MongoDB  
- **File Storage:** Cloudinary  
- **Token Management:** Respect model-specific context windows (e.g., GPT-4-turbo).  
- **Webhooks:** Support for background processing callbacks (file transformations, async jobs).  

---

## 📏 Coding Standards  
- Follow **Next.js best practices**.  
- Write **clean, modular, and readable** code with proper naming conventions.  
- Always use **strict type-checking** in TypeScript.  
- Avoid anti-patterns and outdated JavaScript practices.  
- Document complex logic with comments.  
- Styling must be via **TailwindCSS + ShadCN** only.  
- UI must be fully responsive and tested.  
- All code must be **self-reviewed and tested** before submission.  

---

## ✅ Deliverables Checklist  
- [ ] Pixel-perfect ChatGPT clone UI  
- [ ] Fully functional chat using **Vercel AI SDK**  
- [ ] Message editing + regeneration  
- [ ] Conversation memory (**mem0**)  
- [ ] File & image upload support  
- [ ] MongoDB + Cloudinary integration  
- [ ] Deployment on Vercel  
- [ ] Complete README with setup instructions  
- [ ] Well-documented, maintainable, modular code  

---

## 🔍 Code Review & Submission  
- Only compliant code will be accepted.  
- Every submission undergoes peer review.  
- Be prepared to justify design choices and incorporate feedback.  

---

## 💻 Using Cursor IDE  

Cursor is an **AI-powered IDE** built on VS Code. Here’s how to use it for this project:  

1. **Install Cursor**  
   - Download from [cursor.sh](https://cursor.sh)  
   - Install on macOS, Windows, or Linux.  

2. **Project Setup in Cursor**  
   - Clone the repository.  
   - Open it inside Cursor.  
   - Install dependencies:  
     ```bash
     npm install
     ```  
   - Create a `.env.local` file with required environment variables (MongoDB URI, Clerk keys, Cloudinary credentials, etc.).  

3. **AI Assistance in Cursor**  
   - Use **`Cmd+K`** (Mac) / **`Ctrl+K`** (Windows/Linux) to open AI commands.  
   - Examples:  
     - `Explain this code`  
     - `Refactor to TypeScript`  
     - `Generate TailwindCSS UI for a chat box`  
     - `Write Next.js API route for file upload`  

4. **Live Development**  
   - Run locally:  
     ```bash
     npm run dev
     ```  
   - Preview at: `http://localhost:3000`  

5. **Deployment**  
   - Push to GitHub/GitLab.  
   - Deploy via Vercel (automatic builds with environment variables).  
