import { BrowserRouter, Route, Routes } from 'react-router';
import { WelcomePage } from './pages/Welcome/WelcomePage';
import { WorkingSchemaContextProvider } from './features/WorkingSchemaContext/components/WorkingSchemaContext';
import { EditPage } from './pages/Edit/EditPage';
import { RemoteEditorPage } from './features/RemoteEditor/RemoteEditorPage';

function App() {
    return (
        <div className="App">
            <WorkingSchemaContextProvider>
                <BrowserRouter>
                    <Routes>
                        <Route index element={<WelcomePage />} />
                        <Route path="/edit" element={<RemoteEditorPage />} />
                        {/* TODO: Remove the deprecated editor after the API v2 migration. */}
                        <Route path="/edit/legacy" element={<EditPage />} />
                    </Routes>
                </BrowserRouter>
            </WorkingSchemaContextProvider>
        </div>
    );
}

export default App;
