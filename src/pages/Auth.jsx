import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth, db } from '../lib/firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [formData, setFormData] = useState({ name: '', city: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setLoading(true);

    try {
      let userCredential;
      if (isLogin) {
        userCredential = await signInWithEmailAndPassword(auth, formData.email, formData.password);
        const userDoc = await getDoc(doc(db, 'users', userCredential.user.uid));
        const userData = userDoc.data();
        
        localStorage.setItem('userId', userCredential.user.uid);
        localStorage.setItem('userName', userData?.name || '');

        if (userData?.onboarding_complete === false) {
          navigate('/onboarding');
        } else {
          navigate('/');
        }
      } else {
        userCredential = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
        const userData = {
          name: formData.name,
          city: formData.city,
          email: formData.email,
          nudge_threshold: 4,
          onboarding_complete: false,
          created_at: serverTimestamp(),
        };
        
        await setDoc(doc(db, 'users', userCredential.user.uid), userData);
        
        localStorage.setItem('userId', userCredential.user.uid);
        localStorage.setItem('userName', formData.name);
        navigate('/onboarding');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    setLoading(true);

    try {
      if (!formData.email) {
        throw new Error('Please enter your email address.');
      }
      await sendPasswordResetEmail(auth, formData.email);
      setSuccessMessage('Password reset email sent! Please check your inbox.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gray-50">
      <div className="w-full max-w-[400px]">
        <h1 className="text-3xl font-bold text-brand text-center mb-8">CartSense</h1>
        
        <div className="card shadow-sm">
          {isForgotPassword ? (
            <div>
              <h2 className="text-xl font-bold text-gray-800 text-center mb-2">Reset Password</h2>
              <p className="text-xs text-gray-500 text-center mb-6">
                Enter your registered email address and we'll send you a password reset email from Firebase Auth.
              </p>
              
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
                  <input
                    type="email"
                    required
                    className="input-field"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>

                {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
                {successMessage && <p className="text-green-600 text-xs mt-2 font-medium">{successMessage}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full mt-4"
                >
                  {loading ? 'Sending Reset Link...' : 'Send Reset Email'}
                </button>

                <div className="text-center mt-4">
                  <button
                    type="button"
                    className="text-brand text-xs font-semibold hover:underline"
                    onClick={() => {
                      setIsForgotPassword(false);
                      setError('');
                      setSuccessMessage('');
                    }}
                  >
                    Back to Login
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <>
              <div className="flex mb-6 border-b border-gray-100">
                <button
                  className={`flex-1 pb-3 text-sm font-medium transition-colors ${isLogin ? 'text-brand border-b-2 border-brand' : 'text-gray-400'}`}
                  onClick={() => setIsLogin(true)}
                >
                  Login
                </button>
                <button
                  className={`flex-1 pb-3 text-sm font-medium transition-colors ${!isLogin ? 'text-brand border-b-2 border-brand' : 'text-gray-400'}`}
                  onClick={() => setIsLogin(false)}
                >
                  Signup
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {!isLogin && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                      <input
                        type="text"
                        required
                        className="input-field"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">City</label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Mumbai"
                        className="input-field"
                        value={formData.city}
                        onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                      />
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
                  <input
                    type="email"
                    required
                    className="input-field"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-xs font-medium text-gray-500">Password</label>
                    {isLogin && (
                      <button
                        type="button"
                        className="text-brand text-xs hover:underline"
                        onClick={() => {
                          setIsForgotPassword(true);
                          setError('');
                          setSuccessMessage('');
                        }}
                      >
                        Forgot Password?
                      </button>
                    )}
                  </div>
                  <input
                    type="password"
                    required
                    className="input-field"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  />
                </div>

                {error && <p className="text-red-500 text-xs mt-2">{error}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary w-full mt-4"
                >
                  {loading ? 'Processing...' : isLogin ? 'Login' : 'Signup'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

