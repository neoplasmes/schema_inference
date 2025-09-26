import { renderApplication } from './main/application';

const root = document.getElementById('root');

if (!root) {
    throw new Error('The application root is missing.');
}

renderApplication(root);
