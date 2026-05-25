import { createBrowserRouter, Navigate } from 'react-router-dom';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import AppLayout from '@/layouts/AppLayout';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import CuadrantePage from '@/pages/CuadrantePage';
import ConductoresPage from '@/pages/ConductoresPage';
import LineasPage from '@/pages/LineasPage';
import TiposTurnoPage from '@/pages/TiposTurnoPage';
import IncidenciasPage from '@/pages/IncidenciasPage';
import IntercambiosPage from '@/pages/IntercambiosPage';
import MiHorarioPage from '@/pages/MiHorarioPage';
import MisPreferenciasPage from '@/pages/MisPreferenciasPage';
import TenantsPage from '@/pages/TenantsPage';
import CentrosPage from '@/pages/CentrosPage';
import UsuariosPage from '@/pages/UsuariosPage';
import NotFoundPage from '@/pages/NotFoundPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/login" replace />,
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/dashboard', element: <DashboardPage /> },
          { path: '/cuadrante', element: <CuadrantePage /> },
          { path: '/conductores', element: <ConductoresPage /> },
          { path: '/lineas', element: <LineasPage /> },
          { path: '/tipos-turno', element: <TiposTurnoPage /> },
          { path: '/incidencias', element: <IncidenciasPage /> },
          { path: '/intercambios', element: <IntercambiosPage /> },
          { path: '/mi-horario', element: <MiHorarioPage /> },
          { path: '/mis-preferencias', element: <MisPreferenciasPage /> },
          { path: '/tenants', element: <TenantsPage /> },
          { path: '/centros', element: <CentrosPage /> },
          { path: '/usuarios', element: <UsuariosPage /> },
        ],
      },
    ],
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
]);
