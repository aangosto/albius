import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function App() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-3xl">Hola Albius!</CardTitle>
          <CardDescription>
            Plataforma de gestión de turnos para empresas de transporte urbano.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Monorepo inicializado correctamente. Próximo paso: integración con Firebase.
          </p>
          <Button>Empezar</Button>
        </CardContent>
      </Card>
    </main>
  );
}
