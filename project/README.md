# TrendSync Brand Factory

**AI-Powered Fashion Design Studio**

TrendSync Brand Factory is an innovative AI-powered platform that revolutionizes fashion design by combining trend intelligence, brand consistency, and automated collection generation. Built for fashion designers, brand managers, and creative teams.

---

## 🎯 For Hackathon Judges

### Quick Start - Demo Account

**⚠️ FIRST TIME SETUP REQUIRED:**

The demo account must be created first. Follow these steps:

1. **Open the app** in your browser
2. **Click "Create Account"** tab on the login page
3. **Enter these details:**
   - Full Name: `Demo User`
   - Email: `demo@trendsync.ai`
   - Password: `TrendSync2025!`
4. **Click "Create Account"**
5. **Switch to "Sign In"** and login with the same credentials

**Why?** The database is empty initially. You'll get "Invalid login credentials" error until you create the account.

After creating and logging in:
- Go to **Settings** → Add your Gemini API Key from [Google AI Studio](https://aistudio.google.com/app/apikey)
- Start exploring the platform!

📄 See [DEMO_CREDENTIALS.md](./DEMO_CREDENTIALS.md) for detailed feature walkthrough

---

## ✨ Key Features

### 1. **Brand Style Editor**
Define comprehensive visual rules for your fashion brand:
- Custom color palettes with hex values
- Camera settings (angles, distances, shot types)
- Professional lighting configurations
- Material library (textures, fabrics, finishes)
- Negative prompts for brand consistency

### 2. **AI-Powered Collection Planner**
Generate complete fashion collections in minutes:
- **Trend-Based Generation:** Leverage real-time market trends
- **Celebrity-Inspired:** Create collections based on celebrity fashion
- **Brand Validation:** Every design is validated against your brand guidelines
- **FIBO API Integration:** High-quality, server-side image generation

### 3. **Brand Guardian**
Automated brand validation system:
- Color palette compliance checking
- Style consistency analysis
- Negative prompt violation detection
- Real-time feedback on every design

### 4. **Trend Intelligence**
Market insights powered by Gemini AI + Google Search:
- Regional trend analysis (US, EU, ASIA)
- Celebrity fashion tracking
- Color trend forecasting
- Seasonal trend predictions

### 5. **Tech Pack Generator**
Professional garment specifications:
- Detailed measurements and materials
- Construction guidelines
- Care instructions
- PDF export for manufacturers

### 6. **Multi-User Support**
Role-based access control:
- **Admin:** Full platform access
- **Designer:** Create and manage collections
- **Viewer:** Read-only access (planned)

---

## 🛠 Technical Stack

### Frontend
- **React 18** with TypeScript
- **Vite** for fast development
- **Tailwind CSS** for styling
- **Lucide React** for icons
- **Sonner** for notifications

### Backend
- **Supabase** (PostgreSQL + Auth + Storage)
- **Row Level Security** for multi-tenant isolation
- **Real-time subscriptions** (planned)

### AI & Services
- **Google Gemini 2.5 Flash** with Google Search grounding
- **Bria FIBO API** for fashion image generation
- **Redis** for caching (optional)
- **Resend** for email delivery (optional)

### Design System
- Custom neumorphic UI components
- Pastel color palette
- Smooth animations and micro-interactions
- Responsive design (mobile-first)

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm
- Supabase account
- API keys:
  - Google Gemini API key
  - Bria API key (for FIBO)
  - Resend API key (optional, for email)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd trendsync-brand-factory
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**

   Create a `.env` file in the root directory:
   ```env
   # Supabase
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key

   # AI Services
   VITE_GEMINI_API_KEY=your_gemini_api_key
   VITE_BRIA_API_KEY=your_bria_api_key

   # Optional
   VITE_RESEND_API_KEY=your_resend_api_key
   ```

4. **Set up Supabase**

   Run the migrations in your Supabase project:
   - Navigate to SQL Editor in Supabase Dashboard
   - Execute migrations from `supabase/migrations/` directory
   - Migrations will create all necessary tables and RLS policies

5. **Start development server**
   ```bash
   npm run dev
   ```

6. **Build for production**
   ```bash
   npm run build
   ```

---

## 📁 Project Structure

```
trendsync-brand-factory/
├── src/
│   ├── components/         # React components
│   │   ├── auth/          # Authentication UI
│   │   ├── brand-editor/  # Brand style editor
│   │   ├── brand-guardian/ # Validation system
│   │   ├── collection/    # Collection planner & gallery
│   │   ├── dashboard/     # Main dashboard
│   │   ├── layout/        # Layout components (Sidebar)
│   │   ├── trends/        # Trend intelligence
│   │   └── ui/            # Reusable UI components
│   ├── contexts/          # React contexts (Auth)
│   ├── lib/               # Utilities and helpers
│   ├── services/          # Business logic & API clients
│   │   ├── bria-api.ts    # FIBO image generation
│   │   ├── gemini-api.ts  # Gemini AI client
│   │   ├── gemini-trends.ts # Trend intelligence
│   │   ├── db-storage.ts  # Database abstraction layer
│   │   └── ...
│   ├── types/             # TypeScript type definitions
│   └── App-v2.tsx         # Main application component
├── supabase/
│   ├── functions/         # Edge functions
│   └── migrations/        # Database migrations
├── public/                # Static assets
└── ...
```

---

## 🗄 Database Schema

### Core Tables

#### `brands`
- Stores brand information
- Links to user via `user_id`

#### `brand_styles`
- JSON-based brand style rules
- Color palettes, camera settings, lighting, materials

#### `collections`
- Fashion collections metadata
- Links to brands

#### `collection_items`
- Individual products in collections
- Contains FIBO prompts, generated images, validations

#### `validations`
- Brand validation results
- Compliance scores and violation details

#### `user_profiles`
- Extended user information
- Role-based access control

---

## 🔒 Security

- **Authentication:** Supabase Auth with email/password
- **Authorization:** Row Level Security (RLS) policies
- **Multi-tenant:** Data isolation per user
- **API Keys:** Environment variables (never committed)
- **HTTPS Only:** All API communications

---

## 🎨 Design Philosophy

TrendSync Brand Factory uses a **neumorphic design system** with:
- Soft, raised UI elements
- Pastel color palette (pinks, blues, teals)
- Subtle shadows for depth
- Smooth animations
- Clean typography
- Generous white space

---

## 🧪 Development

### Available Scripts

```bash
npm run dev        # Start development server
npm run build      # Build for production
npm run preview    # Preview production build
npm run lint       # Run ESLint
npm run typecheck  # TypeScript type checking
```

### Code Quality

- **TypeScript** for type safety
- **ESLint** for code linting
- **Prettier** recommended for formatting
- **Component-based architecture**
- **Service layer** for business logic

---

## 📋 Roadmap

### Phase 1: ✅ Complete
- Multi-user authentication
- Brand style editor
- Collection generation
- Trend intelligence
- Database persistence
- Brand validation

### Phase 2: 🚧 In Progress
- Google ADK-JS agent framework integration
- Voice-controlled design companion
- Video generation for product advertisements

### Phase 3: 📅 Planned
- Real-time collaboration
- Advanced role permissions
- Export to e-commerce platforms
- Social media integration
- Analytics dashboard

---

## 🤝 Contributing

This project is currently in active development for a hackathon. Contributions, issues, and feature requests are welcome!

---

## 📄 License

[Add your license here]

---

## 🙏 Acknowledgments

- **Bria AI** for FIBO API
- **Google** for Gemini AI and ADK-JS
- **Supabase** for backend infrastructure
- **Lucide** for beautiful icons

---

## 📞 Support

For questions or issues during evaluation, please contact [your-contact-info].

---

**Built with ❤️ for the fashion industry**
