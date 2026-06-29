import { lazy } from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import AppLayout from '@/layouts/AppLayout';
// Páginas eager: viven fuera del <Suspense> de AppLayout. Login es la entrada
// sin auth; CambiarPassword es flujo crítico de B7; NotFound es el fallback de
// '*'. Mantenerlas eager evita Suspense boundaries extra sin beneficio. B15.
import LoginPage from '@/pages/LoginPage';
import NotFoundPage from '@/pages/NotFoundPage';
import CambiarPasswordPage from '@/pages/CambiarPasswordPage';

// Páginas lazy: las 12 rutas autenticadas bajo AppLayout. Cada una se emite en
// su propio chunk diferido y se descarga al navegar; el <Suspense> de AppLayout
// muestra <LoadingShell fullscreen={false}> mientras tanto. B15 (bundle split).
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const CuadrantePage = lazy(() => import('@/pages/CuadrantePage'));
const CalendarioPage = lazy(() => import('@/pages/CalendarioPage'));
const ConductoresPage = lazy(() => import('@/pages/ConductoresPage'));
const LineasPage = lazy(() => import('@/pages/LineasPage'));
const TiposTurnoPage = lazy(() => import('@/pages/TiposTurnoPage'));
const IncidenciasPage = lazy(() => import('@/pages/IncidenciasPage'));
const IntercambiosPage = lazy(() => import('@/pages/IntercambiosPage'));
const MiHorarioPage = lazy(() => import('@/pages/MiHorarioPage'));
const MisPreferenciasPage = lazy(() => import('@/pages/MisPreferenciasPage'));
const TenantsPage = lazy(() => import('@/pages/TenantsPage'));
const CentrosPage = lazy(() => import('@/pages/CentrosPage'));
const UsuariosPage = lazy(() => import('@/pages/UsuariosPage'));

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
      { path: '/cambiar-password', element: <CambiarPasswordPage /> },
      {
        element: <AppLayout />,
        children: [
          { path: '/dashboard', element: <DashboardPage /> },
          { path: '/cuadrante', element: <CuadrantePage /> },
          { path: '/calendario', element: <CalendarioPage /> },
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
