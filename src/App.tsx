import { BrowserRouter, Route, Routes } from 'react-router';
import { WelcomePage } from './pages/Welcome/WelcomePage';
import { WorkingSchemaContextProvider } from './features/WorkingSchemaContext/WorkingSchemaContext';
import { EditPage } from './pages/Edit/EditPage';

function App() {
    return (
        <div className="App">
            <WorkingSchemaContextProvider>
                <BrowserRouter>
                    <Routes>
                        <Route
                            index
                            element={<WelcomePage />}
                        />
                        <Route
                            path="/edit"
                            element={<EditPage />}
                        />
                    </Routes>
                </BrowserRouter>
            </WorkingSchemaContextProvider>
        </div>
    );
}

export default App;
