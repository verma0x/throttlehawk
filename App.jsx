import Dashboard from './components/Dashboard.jsx';

/**
 * App
 * ---
 * Thin root component. Kept deliberately minimal so Dashboard remains the
 * single source of truth for telemetry state — a router or auth shell
 * would wrap this component in a larger deployment.
 */
export default function App() {
  return <Dashboard />;
}
