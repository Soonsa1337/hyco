import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Zeigt Fehler an, statt ein leeres Fenster zu hinterlassen
class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="auth">
        <div className="card wide">
          <h2>Hyco ist abgestürzt</h2>
          <p className="error">{String(this.state.error?.stack || this.state.error).slice(0, 600)}</p>
          <button className="primary" onClick={() => location.reload()}>Neu laden</button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(<ErrorBoundary><App /></ErrorBoundary>);
