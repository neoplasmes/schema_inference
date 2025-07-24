import { createRoot } from 'react-dom/client';
import StandaloneEditor from './standalone/StandaloneEditor';

const root = document.getElementById('root');

if (!root) {
    throw new Error('The editor root element is missing.');
}

createRoot(root).render(<StandaloneEditor />);
