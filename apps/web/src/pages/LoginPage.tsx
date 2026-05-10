import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">
            albius<span className="text-[#2E75B6]">.</span>
          </CardTitle>
          <CardDescription>Plataforma de gestión de turnos</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Email</span>
            <input
              type="email"
              placeholder="conductor@empresa.es"
              disabled
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Contraseña</span>
            <input
              type="password"
              placeholder="••••••••"
              disabled
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
          {/* TODO[auth]: cablear este botón al signIn de Firebase Auth. */}
          <Button disabled>Entrar</Button>
          <p className="text-xs text-muted-foreground text-center pt-2">
            Login funcional disponible en la próxima sesión.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
