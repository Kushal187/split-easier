import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  Receipt,
  Users,
  PieChart,
  Zap,
  CheckCircle2,
  ArrowRight,
  Star,
  Shield,
  Smartphone,
} from 'lucide-react';
import { BrandIcon, BrandWordmark } from '../components/BrandLogo.jsx';
import { ThemeToggle } from '../components/ThemeToggle.jsx';

const HERO_IMAGE = 'https://images.unsplash.com/photo-1527832574645-f2868a00cef1?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080';

const features = [
  { icon: Receipt, title: 'Item-by-Item Splitting', desc: 'Split each item on a bill to exactly the people who consumed it. No more guessing or averaging.', color: 'landing-feature--indigo' },
  { icon: Users, title: 'Household Groups', desc: 'Create households for roommates, trips, or events. Add members and manage everything in one place.', color: 'landing-feature--violet' },
  { icon: PieChart, title: 'Clear Summaries', desc: 'See exactly who owes what with a clear, itemized breakdown for every member of the group.', color: 'landing-feature--purple' },
  { icon: Zap, title: 'Instant Calculations', desc: 'Amounts are calculated in real time as you add items. No manual math ever.', color: 'landing-feature--pink' },
];

const steps = [
  { number: '01', title: 'Create a Household', desc: 'Set up a group for your roommates, a trip, or any shared expense scenario.' },
  { number: '02', title: 'Add a Bill & Items', desc: "Name your bill (e.g. 'Whole Foods') and add each item with its price." },
  { number: '03', title: 'Split Fairly', desc: 'Assign each item to the people who had it. Everyone sees exactly what they owe.' },
];

export default function LandingPage() {
  return (
    <div className="page-dark landing">
      <div className="page-orbs">
        <div className="page-orb page-orb--indigo" style={{ width: 600, height: 600, top: '-20%', left: '-10%', filter: 'blur(120px)', opacity: 0.4 }} />
        <div className="page-orb page-orb--violet" style={{ width: 500, height: 500, top: '30%', right: '-15%', filter: 'blur(120px)', opacity: 0.4 }} />
        <div className="page-orb page-orb--purple" />
      </div>

      <nav className="landing-nav">
        <Link to="/" className="landing-logo">
          <div className="landing-logo-icon">
            <BrandIcon />
          </div>
          <BrandWordmark className="landing-logo-text" />
        </Link>
        <div className="landing-nav-links">
          <ThemeToggle />
          <Link to="/login" className="landing-nav-link">Sign in</Link>
          <Link to="/signup" className="landing-nav-cta">Get started free</Link>
        </div>
      </nav>

      <section className="landing-hero">
        <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div className="landing-badge">
            <Star size={14} />
            <span>Fair splitting, zero drama</span>
          </div>
          <h1 className="landing-hero-title">
            Split bills fairly, <span className="landing-hero-highlight">item by item</span>
          </h1>
          <p className="landing-hero-desc">
            SplitEasier lets you assign each item on a shared bill to the exact people who consumed it.
            No more averages. No more arguments.
          </p>
          <div className="landing-hero-buttons">
            <Link to="/signup" className="btn-gradient landing-hero-primary">
              Start splitting for free
              <ArrowRight size={16} />
            </Link>
            <Link to="/login" className="landing-hero-secondary">
              Sign in
            </Link>
          </div>
        </motion.div>

        <motion.div
          className="landing-hero-image-wrap"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <div className="landing-hero-image-shade" />
          <div className="landing-hero-image">
            <img src={HERO_IMAGE} alt="Friends splitting a bill" />
          </div>
          <div className="landing-hero-float landing-hero-float--left">
            <div className="landing-hero-float-label">Total bill</div>
            <div className="landing-hero-float-value">$127.40</div>
          </div>
          <div className="landing-hero-float landing-hero-float--right">
            <CheckCircle2 size={16} className="landing-hero-float-check" />
            <span>4 members settled</span>
          </div>
        </motion.div>
      </section>

      <section className="landing-section">
        <div className="landing-section-inner">
          <div className="landing-section-head">
            <h2 className="landing-section-title">Everything you need to split <span>fairly</span></h2>
            <p className="landing-section-desc">Built for the real world — groceries, restaurants, trips, and everything in between.</p>
          </div>
          <div className="landing-features">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                className="landing-feature-card"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <div className={`landing-feature-icon ${f.color}`}>
                  <f.icon size={20} />
                </div>
                <h3 className="landing-feature-title">{f.title}</h3>
                <p className="landing-feature-desc">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-section landing-section--alt">
        <div className="landing-section-inner landing-section-inner--narrow">
          <div className="landing-section-head">
            <h2 className="landing-section-title">How it works</h2>
            <p className="landing-section-desc">Three simple steps to a fair split every time.</p>
          </div>
          <div className="landing-steps">
            {steps.map((step, i) => (
              <motion.div
                key={step.number}
                className="landing-step"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.15 }}
              >
                <div className="landing-step-number">{step.number}</div>
                <h3 className="landing-feature-title">{step.title}</h3>
                <p className="landing-feature-desc">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-trust">
        <div className="landing-trust-inner">
          <div className="landing-trust-item">
            <Shield size={16} className="landing-trust-icon landing-trust-icon--green" />
            <span>Data stored securely, privately</span>
          </div>
          <div className="landing-trust-item">
            <Smartphone size={16} className="landing-trust-icon landing-trust-icon--indigo" />
            <span>Works on all devices</span>
          </div>
          <div className="landing-trust-item">
            <Zap size={16} className="landing-trust-icon landing-trust-icon--yellow" />
            <span>Free forever</span>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-cta-wrap">
          <div className="landing-cta">
            <h2 className="landing-cta-title">Ready to split fairly?</h2>
            <p className="landing-cta-desc">Create your first household and start splitting bills in minutes.</p>
            <Link to="/signup" className="btn-gradient landing-cta-btn">
              Get started — it's free
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-footer-inner">
          <div className="landing-logo-icon landing-logo-icon--sm">
            <BrandIcon title="" />
          </div>
          <span>SplitEasier © {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}
