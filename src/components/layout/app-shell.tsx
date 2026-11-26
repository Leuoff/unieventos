"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowDownUp, ArrowUpRight, Bell, Boxes, CalendarDays, ChevronRight, CircleHelp, ClipboardList, GraduationCap, LayoutDashboard, LoaderCircle, LogOut, Menu, Search, Users } from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useInventory } from "@/components/providers/inventory-provider";
import { useEvents } from "@/components/providers/events-provider";
import { useRequests } from "@/components/providers/requests-provider";
import { useMovements } from "@/components/providers/movements-provider";
import { movementStatusLabels } from "@/types/movements";
import { eventStatusLabels } from "@/types/events";
import { roleLabels } from "@/types/auth";
import { useAuth } from "@/components/providers/auth-provider";

const navigation = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/eventos", label: "Eventos", icon: CalendarDays },
  { href: "/estoque", label: "Estoque", icon: Boxes },
  { href: "/solicitacoes", label: "Solicitações", icon: ClipboardList },
  { href: "/movimentacoes", label: "Movimentações", icon: ArrowDownUp },
];

const adminNavigation = { href: "/usuarios", label: "Usuários e permissões", icon: Users };

function matchesNavigation(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}

function Brand() {
  return <Link href="/" aria-label="UniEventos, início" className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-blue-500 text-white shadow-sm"><CalendarDays className="size-[23px]" strokeWidth={1.8} /></span><div><span className="text-xl font-bold tracking-tight text-white">Uni<span className="font-normal text-blue-200">Eventos</span></span><p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-blue-200/60">Gestão que conecta</p></div></Link>;
}

function SidebarContent({ onNavigate, onHelp }: { onNavigate?: () => void; onHelp: () => void }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const visibleNavigation = user?.role === "ADMIN" ? [...navigation, adminNavigation] : navigation;
  const { loading: stockLoading, error: stockError } = useInventory();
  const { loading: eventsLoading, error: eventsError } = useEvents();
  const { summary: requestSummary, loading: requestsLoading, error: requestsError } = useRequests();
  const { summary: movementSummary, loading: movementsLoading, error: movementsError } = useMovements();
  const loading = stockLoading || eventsLoading || requestsLoading || movementsLoading;
  const error = stockError || eventsError || requestsError || movementsError;
  return <div className="flex h-full flex-col bg-[#102a50] text-blue-100">
    <div className="px-7 pt-9 pb-9"><Brand /></div>
    <div className="mx-5 mb-7 flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-3"><GraduationCap className="size-5 text-blue-200/80" /><div><p className="text-xs font-semibold text-white">UniSALESIANO</p><p className="mt-1 text-[11px] text-blue-200/65">Gestão institucional</p></div><span className="ml-auto size-1.5 rounded-full bg-emerald-400" /></div>
    <p className="px-8 pb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-200/45">Área de trabalho</p>
    <nav aria-label="Navegação principal" className="space-y-1 px-4">{visibleNavigation.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={onNavigate} aria-current={matchesNavigation(pathname, href) ? "page" : undefined} className={cn("group flex items-center gap-3 rounded-lg px-4 py-3 text-[13px] font-medium transition-colors", matchesNavigation(pathname, href) ? "bg-[#2861cf] text-white shadow-[0_4px_14px_#061c3d20]" : "text-blue-100/70 hover:bg-white/7 hover:text-white")}><Icon className="size-[18px]" strokeWidth={1.7} />{label}{href === "/solicitacoes" && !requestsLoading && !requestsError && !!requestSummary?.pending && <span aria-label={`${requestSummary.pending} solicitações pendentes`} className="ml-auto rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white">{requestSummary.pending}</span>}{href === "/movimentacoes" && !movementsLoading && !movementsError && movementSummary.overdue > 0 && <span aria-label={`${movementSummary.overdue} retiradas em atraso`} className="ml-auto rounded-full bg-rose-400/20 px-2 py-0.5 text-[10px] font-semibold text-rose-100">{movementSummary.overdue}</span>}</Link>)}</nav>
    <div className="mt-auto px-5 pt-10 pb-6"><div className="mb-5 rounded-xl border border-white/10 bg-white/[0.035] p-4"><span className="flex items-center gap-2 text-xs font-medium text-blue-100"><span className={cn("size-1.5 shrink-0 rounded-full", loading ? "bg-amber-300" : error ? "bg-red-300" : "bg-emerald-400")} />{loading ? "Consultando cadastros" : error ? "Conexão parcial ou indisponível" : "Cadastros conectados"}</span><p className="mt-2 text-[11px] leading-relaxed text-blue-200/60">{loading ? "Carregando os cadastros e as movimentações." : error ? "Verifique as mensagens dos módulos para tentar novamente." : "Eventos, estoque, solicitações e movimentações persistidos"}</p></div><button type="button" onClick={onHelp} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-xs text-blue-100/65 transition-colors hover:bg-white/5 hover:text-white"><CircleHelp className="size-[17px]" />Como usar o sistema<ArrowUpRight className="ml-auto size-3.5" /></button><div className="mt-5 border-t border-white/10 pt-5 text-center"><span className="text-[14px] font-bold tracking-[-0.5px] text-white/90">UNI<span className="font-normal">SALESIANO</span></span><p className="mt-1.5 text-[10px] uppercase tracking-[0.19em] text-blue-200/40">Presença que transforma</p></div></div>
  </div>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { summary: requestSummary, loading: requestsLoading, error: requestsError, refresh: refreshRequests } = useRequests();
  const { items: events, today, loading: eventsLoading, error: eventsError } = useEvents();
  const { items: equipment, loading: stockLoading, error: stockError } = useInventory();
  const { items: movements, summary: movementSummary, loading: movementsLoading, error: movementsError, refresh: refreshMovements } = useMovements();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const title = [...navigation, adminNavigation].find((item) => matchesNavigation(pathname, item.href))?.label ?? "Página";
  const initials = user?.name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toLocaleUpperCase("pt-BR") ?? "UE";
  async function logout() {
    setSigningOut(true); setLogoutError("");
    try { await signOut({ callbackUrl: "/login" }); }
    catch { setSigningOut(false); setLogoutError("Não foi possível encerrar sua sessão. Tente novamente."); }
  }
  const pending = !requestsLoading && !requestsError && requestSummary ? requestSummary.pending : null;
  const overdue = !movementsLoading && !movementsError ? movementSummary.overdue : null;
  const allResults = [...(!eventsLoading && !eventsError ? events.map((event) => ({ id: `event-${event.id}`, title: event.title, detail: `Evento · ${event.department} · ${event.location} · ${eventStatusLabels[event.status]}`, search: `${event.title} ${event.description} ${event.department} ${event.location} ${event.responsibleName} ${event.id}`, href: `/eventos/${encodeURIComponent(event.id)}` })) : []), ...(!stockLoading && !stockError ? equipment.map((item) => ({ id: `equipment-${item.id}`, title: item.name, detail: `Estoque · ${item.available} disponíveis`, search: `${item.name} ${item.category} ${item.location} ${item.id} ${item.units.map((unit) => unit.assetNumber).join(" ")}`, href: `/estoque/${encodeURIComponent(item.id)}` })) : []), ...(!movementsLoading && !movementsError ? movements.map((item) => ({ id: `movement-${item.id}`, title: item.equipmentName, detail: `Movimentação · ${item.responsibleName} · ${movementStatusLabels[item.status]}`, search: `${item.equipmentName} ${item.eventTitle ?? ""} ${item.responsibleName} ${item.destination} ${item.id} ${item.units.map((unit) => unit.assetNumber).join(" ")}`, href: `/movimentacoes/${encodeURIComponent(item.id)}` })) : [])];
  const results = query.trim() ? allResults.filter((item) => `${item.search} ${item.detail}`.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(query.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) : [];

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((current) => !current);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return <>
    <a href="#main-content" className="sr-only z-[100] rounded bg-white p-3 focus:not-sr-only focus:fixed focus:top-3 focus:left-3">Pular para o conteúdo</a>
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[244px] lg:block"><SidebarContent onHelp={() => setHelpOpen(true)} /></aside>
    <div className="min-h-screen lg:pl-[244px]">
      <header className="sticky top-0 z-20 flex h-[76px] items-center gap-3 border-b bg-white/95 px-4 backdrop-blur-md sm:px-7 xl:px-9">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Abrir menu"><Menu className="size-5" /></Button>
        <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex"><span>Área de trabalho</span><ChevronRight className="size-3" /><span className="font-medium text-slate-700">{title}</span></div>
        <div className="ml-auto flex items-center gap-3 sm:gap-5"><button type="button" onClick={() => setSearchOpen(true)} className="flex h-9 items-center gap-2.5 rounded-lg border border-transparent px-2 text-slate-500 transition-colors hover:border-slate-200 hover:bg-slate-50 sm:w-[230px] sm:border-slate-200 sm:bg-slate-50/70 sm:px-3"><Search className="size-4" /><span className="hidden text-xs sm:block">Buscar no UniEventos...</span><kbd className="ml-auto hidden rounded border bg-white px-1 py-0.5 font-sans text-[10px] text-slate-500 sm:block">Ctrl K</kbd><span className="sr-only sm:hidden">Buscar</span></button>
          <button type="button" aria-label={`Notificações: ${requestsLoading ? "carregando solicitações" : requestsError ? "solicitações indisponíveis" : `${pending ?? 0} solicitações pendentes · ${overdue ?? 0} retiradas em atraso`}`} onClick={() => setNotificationsOpen(true)} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Bell className="size-[19px]" strokeWidth={1.7} />{((pending !== null && pending > 0) || (overdue !== null && overdue > 0)) && <span className="absolute top-1.5 right-2 size-1.5 rounded-full bg-blue-600 ring-2 ring-white" />}</button>
          <div className="flex min-w-0 items-center gap-2.5 border-l pl-3 sm:pl-5"><div aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-white bg-[#e8eefb] text-[11px] font-bold text-blue-700 ring-1 ring-blue-100">{initials}</div><div className="hidden max-w-40 min-w-0 sm:block"><p className="truncate text-xs font-semibold text-slate-700" title={user?.email}>{user?.name}</p><p className="mt-0.5 truncate text-[10px] text-slate-500">{user ? roleLabels[user.role] : "UniSALESIANO"}</p></div><Button variant="ghost" size="icon" disabled={signingOut} onClick={() => void logout()} aria-label="Sair do UniEventos" title="Encerrar sessão">{signingOut ? <LoaderCircle className="size-4 animate-spin" /> : <LogOut className="size-4 text-slate-500" />}</Button></div>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-[1720px] px-4 py-6 sm:px-7 sm:py-8 xl:px-9">{logoutError && <p role="alert" className="mb-5 rounded-lg border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700">{logoutError}</p>}{children}</main>
      <footer className="mx-4 flex flex-wrap items-center justify-between gap-2 border-t py-5 text-[11px] text-slate-500 sm:mx-7 xl:mx-9"><span>© {today.slice(0, 4)} UniEventos · UniSALESIANO</span><span>Feito para conectar pessoas, espaços e possibilidades.</span></footer>
    </div>

    <Dialog open={mobileOpen} onOpenChange={setMobileOpen}><DialogContent className="inset-y-0 left-0 top-0 h-dvh max-h-none w-[280px] max-w-[90vw] translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-none border-0 p-0 [&>button]:text-white"><DialogHeader className="sr-only"><DialogTitle>Menu principal</DialogTitle><DialogDescription>Navegue pelos módulos do UniEventos.</DialogDescription></DialogHeader><SidebarContent onNavigate={() => setMobileOpen(false)} onHelp={() => { setMobileOpen(false); setHelpOpen(true); }} /></DialogContent></Dialog>
    <Dialog open={searchOpen} onOpenChange={setSearchOpen}><DialogContent><DialogHeader><DialogTitle>Buscar no UniEventos</DialogTitle><DialogDescription>Encontre eventos, equipamentos e movimentações cadastrados no sistema.</DialogDescription></DialogHeader><div className="relative"><Search className="absolute top-3 left-3 size-4 text-slate-500" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome, local, patrimônio ou código..." aria-label="Buscar eventos e equipamentos" className="pl-10" /></div>{eventsLoading && <p role="status" className="text-xs text-slate-500">Carregando eventos da agenda…</p>}{eventsError && <p role="status" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Agenda indisponível. A busca de eventos não pôde ser carregada.</p>}{stockLoading && <p role="status" className="text-xs text-slate-500">Carregando equipamentos do estoque…</p>}{stockError && <p role="status" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Estoque indisponível. A busca de equipamentos não pôde ser carregada.</p>}{movementsError && <p role="status" className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">Movimentações indisponíveis para a busca.</p>}<div className="max-h-80 space-y-1 overflow-y-auto">{!query.trim() ? <p className="py-8 text-center text-sm text-slate-500">Digite para encontrar o que precisa.</p> : results.length ? results.slice(0, 12).map((result) => <Link onClick={() => setSearchOpen(false)} key={result.id} href={result.href} className="flex items-center justify-between gap-3 rounded-lg p-3 transition-colors hover:bg-blue-50"><div><p className="text-sm font-medium">{result.title}</p><p className="mt-1 text-xs text-slate-500">{result.detail}</p></div><ChevronRight className="size-4 shrink-0 text-slate-500" /></Link>) : <p className="py-8 text-center text-sm text-slate-500">{stockLoading || eventsLoading ? "Aguarde o carregamento dos cadastros." : stockError || eventsError ? `Nenhum resultado entre os cadastros disponíveis para “${query}”.` : `Nenhum resultado para “${query}”.`}</p>}</div></DialogContent></Dialog>
    <Dialog open={notificationsOpen} onOpenChange={setNotificationsOpen}><DialogContent><DialogHeader><DialogTitle>Central de notificações</DialogTitle><DialogDescription>Pedidos pendentes e devoluções em atraso do UniSALESIANO.</DialogDescription></DialogHeader><div className="space-y-3">{requestsLoading ? <p role="status" className="py-5 text-sm text-slate-500">Carregando solicitações pendentes…</p> : requestsError ? <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm text-amber-800">{requestsError}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void refreshRequests()}>Tentar novamente</Button></div> : pending !== null && pending > 0 ? <Link href="/solicitacoes?status=PENDING" onClick={() => setNotificationsOpen(false)} className="block rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-semibold text-amber-900">{pending} {pending === 1 ? "solicitação aguardando análise" : "solicitações aguardando análise"}</p><p className="mt-1 text-xs text-amber-700">Confira os equipamentos, os períodos e os responsáveis declarados.</p></Link> : <p className="py-5 text-sm text-slate-500">Nenhuma solicitação pendente no momento.</p>}{movementsLoading ? <p role="status" className="text-xs text-slate-500">Consultando devoluções…</p> : movementsError ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><p>{movementsError}</p><Button variant="outline" size="sm" className="mt-2" onClick={() => void refreshMovements()}>Tentar novamente</Button></div> : overdue !== null && overdue > 0 ? <Link href="/movimentacoes?status=OVERDUE" onClick={() => setNotificationsOpen(false)} className="block rounded-xl border border-rose-200 bg-rose-50 p-4"><p className="text-sm font-semibold text-rose-900">{overdue} {overdue === 1 ? "retirada em atraso" : "retiradas em atraso"}</p><p className="mt-1 text-xs text-rose-700">Confira os retornos pendentes e possíveis conflitos com reservas futuras.</p></Link> : <p className="text-sm text-slate-500">Nenhuma devolução em atraso.</p>}<p className="text-xs leading-relaxed text-slate-500">A análise dos pedidos e o cancelamento de reservas aprovadas estão disponíveis conforme as permissões da sua conta.</p></div></DialogContent></Dialog>
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}><DialogContent><DialogHeader><DialogTitle>Uma gestão mais conectada</DialogTitle><DialogDescription>Conheça os módulos do UniEventos.</DialogDescription></DialogHeader><div className="space-y-4 text-sm leading-relaxed text-slate-600"><p><strong className="text-slate-800">Dashboard:</strong> acompanhe os eventos, o estoque e as solicitações pendentes dos três setores.</p><p><strong className="text-slate-800">Eventos:</strong> cadastre, edite e cancele eventos na agenda compartilhada. Consulte calendário, histórico e sobreposições no mesmo local. Os horários seguem America/Sao_Paulo.</p><p><strong className="text-slate-800">Estoque:</strong> consulte equipamentos por quantidade ou patrimônio, disponibilidade, manutenção, reservas e histórico. A edição depende de permissão específica.</p><p><strong className="text-slate-800">Solicitações:</strong> vincule pedidos a eventos reais e consulte disponibilidade por período. Reaproveitar necessidades preliminares não cria reservas automaticamente. Rascunhos e pedidos pendentes não bloqueiam equipamentos.</p><p><strong className="text-slate-800">Movimentações:</strong> registre retiradas de reservas aprovadas e confira devoluções totais ou parciais. Consulte atrasos, avarias, extravios e o histórico de cada patrimônio. O registro exige permissão específica.</p><p className="rounded-lg bg-blue-50 p-3 text-xs text-blue-700">Sua conta define o setor e as operações permitidas. Responsáveis operacionais continuam informados no cadastro; registros anteriores sem autoria autenticada são preservados. As permissões são verificadas pelo servidor em cada operação.</p></div><Button onClick={() => setHelpOpen(false)}>Entendi, vamos começar</Button></DialogContent></Dialog>
  </>;
}
