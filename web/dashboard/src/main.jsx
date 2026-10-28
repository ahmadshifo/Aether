// Member 2: mounts the dashboard React application and global style sheet.
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import '@fontsource-variable/plus-jakarta-sans';
import './styles.css';

createRoot(document.getElementById('root')).render(<App />);
