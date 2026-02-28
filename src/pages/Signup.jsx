import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Eye, EyeOff, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { BrandIcon, BrandWordmark } from '../components/BrandLogo.jsx';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(email.trim(), password, name.trim());
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message || err.data?.error || 'Sign up failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-dark auth-page">
      <div className="page-orbs">
        <div className="page-orb page-orb--indigo-alt" />
        <div className="page-orb page-orb--violet" />
      </div>
      <motion.div
        className="page-content auth-center"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <div className="auth-logo">
          <Link to="/" className="auth-logo-link">
            <div className="auth-logo-icon">
              <BrandIcon />
            </div>
            <BrandWordmark className="auth-logo-text" />
          </Link>
          <p className="auth-subtitle">Create your account</p>
        </div>

        <div className="card-glass">
          <form onSubmit={handleSubmit}>
            {error && (
              <div className="alert-error">{error}</div>
            )}
            <div>
              <label className="label-glass">Your name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Johnson"
                autoComplete="name"
                required
                className="input-glass"
              />
            </div>
            <div>
              <label className="label-glass">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="input-glass"
              />
            </div>
            <div>
              <label className="label-glass">Password</label>
              <div className="input-wrap">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  className="input-glass"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="input-toggle-pw"
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <button type="submit" className="btn-gradient" disabled={loading}>
              {loading ? (
                <span className="spinner" />
              ) : (
                <>
                  Create account
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>
          <p className="auth-footer">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
