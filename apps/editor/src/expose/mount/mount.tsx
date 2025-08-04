import { createRoot } from 'react-dom/client';
import Editor from '../editor';
import type { EditorProps } from '../editor';

export function mount(
    element: HTMLElement,
    props: EditorProps
): {
    update(nextProps: EditorProps): void;
    unmount(): void;
} {
    const root = createRoot(element);
    let active = true;

    root.render(<Editor {...props} />);

    return {
        update(nextProps) {
            if (!active) {
                throw new Error('The editor has been unmounted.');
            }

            root.render(<Editor {...nextProps} />);
        },
        unmount() {
            if (!active) {
                return;
            }

            active = false;
            root.unmount();
        },
    };
}
