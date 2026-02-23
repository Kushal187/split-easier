import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Receipt, Eye, EyeOff, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [splitwiseLoading, setSplitwiseLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err.message || err.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  function handleSplitwiseSignIn() {
    setSplitwiseLoading(true);
    window.location.href = '/api/auth/splitwise/start';
  }

  return (
    <div className="page-dark auth-page">
      <div className="page-orbs">
        <div className="page-orb page-orb--indigo" />
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
              <Receipt size={24} />
            </div>
            <span className="auth-logo-text">
              Split<span>Wiser</span>
            </span>
          </Link>
          <p className="auth-subtitle">Welcome back</p>
        </div>

        <div className="card-glass">
          <button type="button" className="btn-splitwise" onClick={handleSplitwiseSignIn} disabled={splitwiseLoading || loading}>
            {splitwiseLoading ? 'Redirecting to Splitwise…' : 'Continue with Splitwise'}
          </button>
          <div className="auth-divider">or use email and password</div>

          <form onSubmit={handleSubmit}>
            {error && (
              <div className="alert-error">{error}</div>
            )}
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
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
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
            <button type="submit" className="btn-gradient" disabled={loading || splitwiseLoading}>
              {loading ? (
                <span className="spinner" />
              ) : (
                <>
                  Sign in
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>
          <p className="auth-footer">
            Don&apos;t have an account? <Link to="/signup">Sign up</Link>
          </p>
        </div>
      </motion.div>
    </div>
  );
}
