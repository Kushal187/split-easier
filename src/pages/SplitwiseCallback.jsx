import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Receipt } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

function getParams() {
  const hashParams = new URLSearchParams(window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '');
  const searchParams = new URLSearchParams(window.location.search);
  return {
    token: hashParams.get('token') || searchParams.get('token') || '',
    user: hashParams.get('user') || searchParams.get('user') || '',
    error: hashParams.get('error') || searchParams.get('error') || ''
  };
}

export default function SplitwiseCallback() {
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { applyAuth } = useAuth();

  useEffect(() => {
    const { token, user, error: oauthError } = getParams();

    if (oauthError) {
      setError(oauthError);
      return;
    }

    if (!token || !user) {
      setError('Splitwise sign-in did not return a session. Please try again.');
      return;
    }

    try {
      const parsedUser = JSON.parse(user);
      applyAuth(token, parsedUser);
      navigate('/dashboard', { replace: true });
    } catch (_) {
      setError('Unable to read Splitwise login response. Please try again.');
    }
  }, [applyAuth, navigate]);

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
        transition={{ duration: 0.4 }}
      >
        <div className="auth-logo">
          <Link to="/" className="auth-logo-link">
            <div className="auth-logo-icon">
              <Receipt size={24} />
            </div>
            <span className="auth-logo-text">
              Split<span>Easier</span>
            </span>
          </Link>
          <p className="auth-subtitle">Finishing Splitwise sign-in...</p>
        </div>

        <div className="card-glass">
          {error ? (
            <>
              <div className="alert-error">{error}</div>
              <p className="auth-footer">
                <Link to="/login">Back to login</Link>
              </p>
            </>
          ) : (
            <p className="welcome-sub">Completing authentication...</p>
          )}
        </div>
      </motion.div>
    </div>
  );
}
