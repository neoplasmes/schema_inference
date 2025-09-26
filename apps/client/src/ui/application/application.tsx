import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { WorkspacePage } from '../pages/workspace';
import { RemoteEditorPage } from '../pages/remote_editor';

export function Application(): React.JSX.Element {
    return (
        <BrowserRouter>
            <Routes>
                <Route index element={<WorkspacePage />} />
                <Route path="/edit" element={<RemoteEditorPage />} />
                <Route
                    path="/edit/legacy"
                    element={<Navigate to="/edit?demo=1" replace />}
                />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
        </BrowserRouter>
    );
}
