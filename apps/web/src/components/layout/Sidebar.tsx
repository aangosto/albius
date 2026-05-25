import { NavLink } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { NAV_BY_ROL, type NavItem } from '@/lib/navigation';
import { cn } from '@/lib/utils';

function NavSection({ title, items }: { title?: string; items: NavItem[] }) {
  return (
    <div className="py-2">
      {title && (
        <div className="px-6 pt-3 pb-2 text-[10px] font-mono uppercase tracking-[0.18em] text-white/40">
          {title}
        </div>
      )}
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-6 py-2.5 text-sm border-l-[3px] transition-colors',
                isActive
                  ? 'text-white border-[#2E75B6] bg-white/[0.08]'
                  : 'text-white/70 border-transparent hover:text-white hover:bg-white/5',
              )
            }
          >
            <Icon className="size-4 opacity-80" />
            {item.label}
          </NavLink>
        );
      })}
    </div>
  );
}

export default function Sidebar() {
  const { user } = useAuth();
  // Defensa: ProtectedRoute garantiza que solo llegamos aquí con user.rol válido.
  if (!user?.rol) return null;

  const sections = NAV_BY_ROL[user.rol];
  // Solo se muestran títulos cuando hay >1 sección (super_admin).
  const showTitles = sections.length > 1;

  return (
    <aside className="hidden md:flex flex-col w-60 text-white bg-[#0E2A47]">
      <div className="px-6 py-6 text-2xl font-bold tracking-tight border-b border-white/10">
        albius<span className="text-[#2E75B6]">.</span>
      </div>
      <nav className="flex-1 overflow-y-auto">
        {sections.map((section, idx) => (
          <NavSection
            key={idx}
            title={showTitles ? section.title : undefined}
            items={section.items}
          />
        ))}
      </nav>
    </aside>
  );
}
