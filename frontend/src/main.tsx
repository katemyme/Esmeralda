import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorApi } from './api/cliente';
import { App } from './App';
import { ProveedorSesion } from './sesion/sesion';
import './tema/tema.css';

const consultas = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Sin permiso o sin equipo no tiene sentido insistir; lo demás (la red) se reintenta dos veces
      retry: (intentos, error) =>
        intentos < 2 && !(error instanceof ErrorApi && error.estado >= 400 && error.estado < 500),
    },
  },
});

const raiz = document.getElementById('raiz');
if (!raiz) throw new Error('Falta el elemento #raiz en index.html');

createRoot(raiz).render(
  <StrictMode>
    <QueryClientProvider client={consultas}>
      <ProveedorSesion>
        <App />
      </ProveedorSesion>
    </QueryClientProvider>
  </StrictMode>,
);
