import { useCallback, useEffect, useRef, useState } from 'react';

import { useNavigate } from 'react-router';

import { useWorkingSchemaContext } from '../../features/WorkingSchemaContext/components/WorkingSchemaContext';
import { SchemaDataEntry } from '../../model/treeModel';
import mockData from '../../sample.json';
import { bem } from '../../shared/bem/bem';
import './WelcomePage.scss';

const block = bem('GeneratePage');
// Интерфейс для ответа от POST-запроса
type UploadResponse = {
    message: string;
    session_id: string;
};

// Интерфейс для сообщений от WebSocket
type WebSocketMessage = Partial<{
    status: 'progress' | 'completed';
    processed: number;
    total: number;
    progress: number;
    message: any;
    error: string;
}>;

export const WelcomePage = () => {
    const [files, setFiles] = useState<FileList | null>(null);
    const websocketRef = useRef<WebSocket | null>(null);

    const startTime = useRef<number>(0);

    const { initialize: initializeWorkingSchema } = useWorkingSchemaContext();
    const navigate = useNavigate();

    const handleAttachFiles = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        setFiles(event.target.files);
    }, []);

    const handleUpload = useCallback(() => {
        const upload = async () => {
            if (!files) {
                initializeWorkingSchema(mockData as unknown as Record<string, SchemaDataEntry>);
                navigate('/edit');
                return;
            }

            const formData = new FormData();
            Array.from(files).forEach(file => {
                formData.append('files', file);
            });

            startTime.current = Date.now();
            try {
                const response = await fetch('http://localhost:8000/schema/uploadfiles/', {
                    method: 'POST',
                    body: formData,
                    // Нет необходимости явно указывать 'Content-Type': 'multipart/form-data',
                    // так как fetch автоматически устанавливает его при использовании FormData
                });

                if (!response.ok) {
                    throw new Error(`Ошибка HTTP: ${response.status}`);
                }

                const data: UploadResponse = await response.json();
                // Подключаемся к WebSocket с session_id
                connectWebSocket(data.session_id);
            } catch (error) {
                console.error(error);
            }
        };

        upload();
    }, [files]);

    const connectWebSocket = useCallback((session_id: string) => {
        // 0 - Connecting, 1 - Open
        if (websocketRef.current?.readyState === 0 || websocketRef.current?.readyState === 1) {
            console.log(websocketRef.current);
            return;
        }

        websocketRef.current = new WebSocket(`ws://localhost:8000/schema/ws/process/${session_id}`);
        const websocket = websocketRef.current;

        websocket.onopen = () => {
            console.log('WebSocket подключен');
        };

        websocket.onmessage = (event: MessageEvent) => {
            const data: WebSocketMessage = JSON.parse(event.data);

            if (data.error) {
                throw new Error(data.error);
            }

            switch (data.status) {
                case 'progress':
                    console.log('progress message');
                    break;
                case 'completed':
                    websocket.close();
                    if (!data.message) {
                        throw new Error('Message has not been provided on completed state');
                    }

                    console.log((Date.now() - startTime.current) / 1000);

                    const jsonSchemaData: Record<string, SchemaDataEntry> = JSON.parse(data.message);
                    initializeWorkingSchema(jsonSchemaData);
                    navigate('/edit');
                    break;
                default:
                    throw new Error('Unprovided status');
            }
        };

        websocket.onclose = () => {
            console.log('WebSocket отключен');
        };

        websocket.onerror = (error: Event) => {
            console.error('Ошибка WebSocket:', error);
            websocket.close();
        };
    }, []);

    useEffect(() => {
        return () => {
            if (websocketRef.current) {
                websocketRef.current.close();
            }
        };
    }, []);

    return (
        <div>
            <input
                type="file"
                multiple
                accept=".xml"
                onChange={handleAttachFiles}
            />
            <button onClick={handleUpload}>Построить схему</button>
        </div>
    );
};
