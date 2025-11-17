import { createRoot } from 'react-dom/client';
import { StandaloneEditor } from './standalone';
import { Editor } from './main/Editor';

const root = document.getElementById('root');

if (!root) {
    throw new Error('The editor root element is missing.');
}

createRoot(root).render(<StandaloneEditor Editor={Editor} />);
