import { NavLink } from 'react-router-dom';
import { NAV_ITEMS, type NavItem } from '@/lib/navigation';
import { cn } from '@/lib/utils';

function NavSection({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <div className="py-2">
      <div className="px-6 pt-3 pb-2 text-[10px] font-mono uppercase tracking-[0.18em] text-white/40">
        {title}
      </div>
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
  const jefeItems = NAV_ITEMS.filter((i) => i.rol === 'jefe');
  const conductorItems = NAV_ITEMS.filter((i) => i.rol === 'conductor');

  return (
    <aside className="hidden md:flex flex-col w-60 text-white bg-[#0E2A47]">
      <div className="px-6 py-6 text-2xl font-bold tracking-tight border-b border-white/10">
        albius<span className="text-[#2E75B6]">.</span>
      </div>
      <nav className="flex-1 overflow-y-auto">
        <NavSection title="Jefe de tráfico" items={jefeItems} />
        <NavSection title="Conductor" items={conductorItems} />
      </nav>
    </aside>
  );
}
