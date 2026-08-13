import { lazy, Suspense } from "react";
import ScrollToTop from "./components/ScrollToTop";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import CookieBanner from "./components/CookieBanner";
import MaintenanceGate from "./components/MaintenanceGate";
import { MetaPixelLoader } from "./components/MetaPixelLoader";
import { GA4Loader } from "./components/GA4Loader";
import { ThemeProvider } from "./contexts/ThemeContext";
import { CommunityProvider } from "./contexts/CommunityContext";
import { AdminCommunityProvider } from "./contexts/AdminCommunityContext";
import "./lib/i18n";

// ── SEGOLIFE (lazy — páginas nuevas, independientes de la app heredada) ─────
// Fase 6: experiencia pública definitiva del estudiante — reemplaza
// CommunityHome/StudentProfile/MyBenefits (Fases 1B/1C/4), que quedan
// retiradas. `SegolifeHome` (no `Home`, ya usado por la home legada Náyade).
const SegolifeHome = lazy(() => import("./pages/segolife/Home"));
const Explore = lazy(() => import("./pages/segolife/Explore"));
const SegolifeEventDetail = lazy(() => import("./pages/segolife/EventDetail"));
const SegolifeVenueDetail = lazy(() => import("./pages/segolife/VenueDetail"));
const Rewards = lazy(() => import("./pages/segolife/Rewards"));
const BenefitDetail = lazy(() => import("./pages/segolife/BenefitDetail"));
const SegolifeProfile = lazy(() => import("./pages/segolife/Profile"));
const Activity = lazy(() => import("./pages/segolife/Activity"));
// Fase 7: Engagement Core — inbox de notificaciones + ajustes de preferencias.
const SegolifeNotifications = lazy(() => import("./pages/segolife/Notifications"));
const NotificationPreferences = lazy(() => import("./pages/segolife/NotificationPreferences"));
// Fase 8: Native Ticketing — checkout, My Tickets, staff scanner/POS.
const TicketCheckout = lazy(() => import("./pages/segolife/TicketCheckout"));
const MyTickets = lazy(() => import("./pages/segolife/MyTickets"));
const TicketDetail = lazy(() => import("./pages/segolife/TicketDetail"));
const StaffEventScan = lazy(() => import("./pages/staff/StaffEventScan"));
const StaffPos = lazy(() => import("./pages/staff/StaffPos"));

// ── PUBLIC PAGES (carga inmediata — visibles sin autenticación) ──────────────
// `Home` (home heredada de Náyade Experiences) ya NO se monta en "/" desde
// Fase 8.5 — sustituida por `PublicHome` (nueva Home SEGOLIFE). El archivo y
// la ruta legacy siguen existiendo en el repo (no se ha purgado código,
// solo se ha dejado de enlazar), por si algún flujo heredado aún la referencia.
import PublicHome from "./pages/PublicHome";
import Experiences from "./pages/Experiences";
import ExperienceDetail from "./pages/ExperienceDetail";
import Gallery from "./pages/Gallery";
import BudgetRequest from "./pages/BudgetRequest";
import Colegios from "./pages/Colegios";
import CanjearCupon from "./pages/CanjearCupon";
import VerificarBono from "./pages/VerificarBono";
import RegistrarGasto from "./pages/RegistrarGasto";
import Contact from "./pages/Contact";
import Locations from "./pages/Locations";
import LegoPacksHome from "./pages/LegoPacksHome";
import LegoPacksList from "./pages/LegoPacksList";
import LegoPackDetail from "./pages/LegoPackDetail";
import Hotel from "./pages/Hotel";
import Spa from "./pages/Spa";
import Restaurantes from "./pages/Restaurantes";
import RestauranteDetail from "./pages/RestauranteDetail";
import RestauranteReservaOk from "./pages/RestauranteReservaOk";
import RestauranteReservaKo from "./pages/RestauranteReservaKo";
import ReservaOk from "./pages/ReservaOk";
import ReservaError from "./pages/ReservaError";
import SetPassword from "./pages/SetPassword";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import DynamicPage from "./pages/DynamicPage";
import QuoteAcceptance from "./pages/QuoteAcceptance";
import ProposalView from "./pages/ProposalView";
import HotelRoom from "./pages/HotelRoom";
import SpaDetail from "./pages/SpaDetail";
import RestaurantBooking from "./pages/RestaurantBooking";
import Checkout from "./pages/Checkout";
import PoliticaPrivacidad from "./pages/PoliticaPrivacidad";
import TerminosCondiciones from "./pages/TerminosCondiciones";
import PoliticaCookies from "./pages/PoliticaCookies";
import CondicionesCancelacion from "./pages/CondicionesCancelacion";

// ── ADMIN PAGES (lazy — solo se cargan cuando el usuario navega a /admin) ────
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));

// CMS
const SlideshowManager = lazy(() => import("./pages/admin/cms/SlideshowManager"));
const MenusManager = lazy(() => import("./pages/admin/cms/MenusManager"));
const PagesManager = lazy(() => import("./pages/admin/cms/PagesManager"));
const MultimediaManager = lazy(() => import("./pages/admin/cms/MultimediaManager"));
const HomeModulesManager = lazy(() => import("./pages/admin/cms/HomeModulesManager"));
const GalleryManager = lazy(() => import("./pages/admin/cms/GalleryManager"));
const SegolifeHomeManager = lazy(() => import("./pages/admin/cms/SegolifeHomeManager"));

// Products
const ExperiencesManager = lazy(() => import("./pages/admin/products/ExperiencesManager"));
const CategoriesManager = lazy(() => import("./pages/admin/products/CategoriesManager"));
const LocationsManager = lazy(() => import("./pages/admin/products/LocationsManager"));
const VariantsManager = lazy(() => import("./pages/admin/products/VariantsManager"));
const LegoPacksManager = lazy(() => import("./pages/admin/products/LegoPacksManager"));

// Operations
const CalendarView = lazy(() => import("./pages/admin/operations/CalendarView"));
const BookingsList = lazy(() => import("./pages/admin/operations/BookingsList"));
const DailyActivities = lazy(() => import("./pages/admin/operations/DailyActivities"));
const HRDashboard = lazy(() => import("./pages/admin/hr/HRDashboard"));
const EmployeesList = lazy(() => import("./pages/admin/hr/EmployeesList"));
const EmployeeDetail = lazy(() => import("./pages/admin/hr/EmployeeDetail"));
const TimeClockManager = lazy(() => import("./pages/admin/hr/TimeClockManager"));
// Fase 5 RRHH — Nóminas y Remesas
const PayslipsManager = lazy(() => import("./pages/admin/hr/PayslipsManager"));
const PayrollBatchesManager = lazy(() => import("./pages/admin/hr/PayrollBatchesManager"));
const BatchDetail = lazy(() => import("./pages/admin/hr/BatchDetail"));
const HRSettings = lazy(() => import("./pages/admin/hr/HRSettings"));
// Fase 6 RRHH — Bonus
const BonusManager = lazy(() => import("./pages/admin/hr/BonusManager"));
// Fase 7 RRHH — Fiscal
const HRFiscalLedger = lazy(() => import("./pages/admin/hr/HRFiscalLedger"));
// Gestoría e Impuestos
const GestoriaDashboard = lazy(() => import("./pages/admin/gestoria/GestoriaDashboard"));
const GestoriaCalendario = lazy(() => import("./pages/admin/gestoria/GestoriaCalendario"));
const GestoriaConfiguracion = lazy(() => import("./pages/admin/gestoria/GestoriaConfiguracion"));
const GestoriaIVA = lazy(() => import("./pages/admin/gestoria/GestoriaIVA"));
const GestoriaLaboral = lazy(() => import("./pages/admin/gestoria/GestoriaLaboral"));
const GestoriaSociedades = lazy(() => import("./pages/admin/gestoria/GestoriaSociedades"));
const GestoriaExpedientes = lazy(() => import("./pages/admin/gestoria/GestoriaExpedientes"));
const GestoriaAplazamientos = lazy(() => import("./pages/admin/gestoria/GestoriaAplazamientos"));
const GestoriaPortal = lazy(() => import("./pages/gestoria/GestoriaPortal"));
const ActivarGestoria = lazy(() => import("./pages/gestoria/ActivarGestoria"));
// Fase 8 RRHH — Vacaciones
const LeaveManager = lazy(() => import("./pages/admin/hr/LeaveManager"));
const MyLeaves = lazy(() => import("./pages/employee/MyLeaves"));
// Portal del Empleado (Fase 3 RRHH)
const EmployeePortal = lazy(() => import("./pages/employee/EmployeePortal"));
const MyProfile = lazy(() => import("./pages/employee/MyProfile"));
const MyDocuments = lazy(() => import("./pages/employee/MyDocuments"));
const MyTimeClock = lazy(() => import("./pages/employee/MyTimeClock"));
const MyPayslips = lazy(() => import("./pages/employee/MyPayslips"));
const ActivarEmpleado = lazy(() => import("./pages/employee/ActivarEmpleado"));

// Accounting
const AccountingDashboard = lazy(() => import("./pages/admin/accounting/AccountingDashboard"));
const DailyControlCenter = lazy(() => import("./pages/admin/accounting/DailyControlCenter"));
const TransactionsList = lazy(() => import("./pages/admin/accounting/TransactionsList"));
const AccountingReports = lazy(() => import("./pages/admin/accounting/AccountingReports"));
const ExpensesManager = lazy(() => import("./pages/admin/accounting/ExpensesManager"));
const ExpenseCategoriesManager = lazy(() => import("./pages/admin/accounting/ExpenseCategoriesManager"));
const ExpenseSuppliersManager = lazy(() => import("./pages/admin/accounting/ExpenseSuppliersManager"));
const CostCentersManager = lazy(() => import("./pages/admin/accounting/CostCentersManager"));
const CashRegisterManager = lazy(() => import("./pages/admin/accounting/CashRegisterManager"));
const RecurringExpensesManager = lazy(() => import("./pages/admin/accounting/RecurringExpensesManager"));
const ProfitLossReport = lazy(() => import("./pages/admin/accounting/ProfitLossReport"));
const BankMovementsManager = lazy(() => import("./pages/admin/accounting/BankMovementsManager"));
const CardTerminalOperationsManager = lazy(() => import("./pages/admin/accounting/CardTerminalOperationsManager"));
const CardTerminalBatchesManager = lazy(() => import("./pages/admin/accounting/CardTerminalBatchesManager"));
const CardTerminalConciliationDashboard = lazy(() => import("./pages/admin/accounting/CardTerminalConciliationDashboard"));

// Hotel & SPA
const HotelManager = lazy(() => import("./pages/admin/hotel/HotelManager"));
const SpaManager = lazy(() => import("./pages/admin/spa/SpaManager"));
const ReviewsManager = lazy(() => import("./pages/admin/ReviewsManager"));

// Restaurants Admin
const RestaurantsManager = lazy(() => import("./pages/admin/restaurants/RestaurantsManager"));
const GlobalCalendar = lazy(() => import("./pages/admin/restaurants/GlobalCalendar"));

// Segolife: CRM de estudiantes (Fase 1C)
const StudentsManager = lazy(() => import("./pages/admin/students/StudentsManager"));
const StudentDetail = lazy(() => import("./pages/admin/students/StudentDetail"));

// Segolife: Historical Fourvenues Identity Claim
const HistoricalIdentities = lazy(() => import("./pages/admin/students/HistoricalIdentities"));
const HistoricalIdentityDetail = lazy(() => import("./pages/admin/students/HistoricalIdentityDetail"));

// Segolife: Venues / Negocios / Eventos (Fase 1D)
const VenuesManager = lazy(() => import("./pages/admin/venues/VenuesManager"));
const VenueDetail = lazy(() => import("./pages/admin/venues/VenueDetail"));
const EventsManager = lazy(() => import("./pages/admin/events/EventsManager"));
const EventCreate = lazy(() => import("./pages/admin/events/EventCreate"));
const EventDetail = lazy(() => import("./pages/admin/events/EventDetail"));

// Segolife: Motor de SegoTokens (Fase 2)
const TokensDashboard = lazy(() => import("./pages/admin/tokens/TokensDashboard"));
const TokensRulesManager = lazy(() => import("./pages/admin/tokens/RulesManager"));
const TokensCampaignsManager = lazy(() => import("./pages/admin/tokens/CampaignsManager"));

// Segolife: QR de consumición (Fase 3)
const QrManager = lazy(() => import("./pages/admin/qr/QrManager"));
const StudentScan = lazy(() => import("./pages/segolife/StudentScan"));

// Segolife: Motor de Benefits (Fase 4)
const BenefitsManager = lazy(() => import("./pages/admin/benefits/BenefitsManager"));
const EngagementCampaignsManager = lazy(() => import("./pages/admin/engagement/CampaignsManager"));
const EngagementNotificationsLog = lazy(() => import("./pages/admin/engagement/NotificationsLog"));
const EngagementDeliveriesLog = lazy(() => import("./pages/admin/engagement/DeliveriesLog"));
const EngagementTemplatesViewer = lazy(() => import("./pages/admin/engagement/TemplatesViewer"));
const EngagementAudiencePage = lazy(() => import("./pages/admin/engagement/AudiencePage"));
const StaffBenefitScan = lazy(() => import("./pages/staff/StaffBenefitScan"));

// Segolife: COMUNITY — inteligencia social/sondeos/propuestas de estudiante
const ComunityManager = lazy(() => import("./pages/admin/comunity/ComunityManager"));
const ComunityWizard = lazy(() => import("./pages/admin/comunity/ComunityWizard"));
const ComunityDetail = lazy(() => import("./pages/admin/comunity/ComunityDetail"));
const ComunityModeration = lazy(() => import("./pages/admin/comunity/ComunityModeration"));
const ComunityHub = lazy(() => import("./pages/segolife/ComunityHub"));
const ComunityQuestionDetail = lazy(() => import("./pages/segolife/ComunityQuestionDetail"));

// Segolife: Ticketing & Commerce Core + Integration Hub (Fase 5)
const IntegrationsManager = lazy(() => import("./pages/admin/integrations/IntegrationsManager"));
const UnresolvedOperations = lazy(() => import("./pages/admin/integrations/UnresolvedOperations"));

// Users & Settings
const UsersManager = lazy(() => import("./pages/admin/users/UsersManager"));
const Settings = lazy(() => import("./pages/admin/settings/Settings"));
const AdvancedSettings = lazy(() => import("./pages/admin/settings/AdvancedSettings"));
const ConfigPanel = lazy(() => import("./pages/admin/settings/ConfigPanel"));
const ConfigStatus = lazy(() => import("./pages/admin/settings/ConfigStatus"));
const OnboardingWizard = lazy(() => import("./pages/admin/onboarding/OnboardingWizard"));

// CRM
const CRMDashboard = lazy(() => import("./pages/admin/crm/CRMDashboard"));
const ClientsManager = lazy(() => import("./pages/admin/crm/ClientsManager"));
const ProposalsPage = lazy(() => import("./pages/admin/crm/ProposalsPage"));
const CommercialFollowupDashboard = lazy(() => import("./pages/admin/commercial/CommercialFollowupDashboard"));
const WhatsAppGHLInbox = lazy(() => import("./pages/admin/commercial/WhatsAppGHLInbox"));
const VapiAgente = lazy(() => import("./pages/admin/commercial/VapiAgente"));
const EmailInbox = lazy(() => import("./pages/admin/commercial/EmailInbox"));
const EmailAccountsSettings = lazy(() => import("./pages/admin/settings/EmailAccountsSettings"));
const SolicitarAnulacion = lazy(() => import("./pages/SolicitarAnulacion"));

// Fiscal REAV
const ReavManager = lazy(() => import("./pages/admin/fiscal/ReavManager"));

// Partners (admin)
const PartnersManager = lazy(() => import("./pages/admin/partners/PartnersManager"));
const PartnerBillingManager = lazy(() => import("./pages/admin/partners/PartnerBillingManager"));

// Partner portal (lazy)
const ActivarPartner = lazy(() => import("./pages/partner/ActivarPartner"));
const PartnerDashboard = lazy(() => import("./pages/partner/PartnerDashboard"));
const PartnerLeadNuevo = lazy(() => import("./pages/partner/PartnerLeadNuevo"));
const PartnerReservaNueva = lazy(() => import("./pages/partner/PartnerReservaNueva"));

// Supplier portal (lazy)
const SupplierDashboard = lazy(() => import("./pages/supplier/SupplierDashboard"));
const ActivarProveedor = lazy(() => import("./pages/supplier/ActivarProveedor"));

// Suppliers & Settlements
const SuppliersManager = lazy(() => import("./pages/admin/suppliers/SuppliersManager"));
const SettlementsManager = lazy(() => import("./pages/admin/suppliers/SettlementsManager"));

// Marketing
const DiscountCodesManager = lazy(() => import("./pages/DiscountCodesManager"));
const CuponesManager = lazy(() => import("./pages/admin/marketing/CuponesManager"));
const PlatformsManager = lazy(() => import("./pages/admin/marketing/PlatformsManager"));

// TPV
const TpvScreen = lazy(() => import("./pages/admin/tpv/TpvScreen"));
const TpvBackoffice = lazy(() => import("./pages/admin/tpv/TpvBackoffice"));

// Plantillas Email — legacy Náyade/Skicenter, ARCHIVADO (spec Communication
// Center): código intacto, sin importar ni enrutar. /admin/plantillas-email
// ahora renderiza el mismo Communication Center que /admin/engagement/templates
// (ver client/src/pages/admin/engagement/TemplatesViewer.tsx).
const PdfTemplatesManager = lazy(() => import("./pages/admin/PdfTemplatesManager"));

// Series de numeración
const DocumentNumbersAdmin = lazy(() => import("./pages/admin/DocumentNumbersAdmin"));

// Fallback de carga para páginas admin
function AdminLoadingFallback() {
  return (
    <div className="min-h-screen bg-[#080e1c] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function Router() {
  return (
    <Switch>
      {/* ── PUBLIC ROUTES ── */}
      <Route path="/" component={PublicHome} />

      {/* ── SEGOLIFE: escáner de staff para validar Benefits en puerta (Fase 4) ── */}
      <Route path="/staff/benefits/scan">{() => <Suspense fallback={null}><StaffBenefitScan /></Suspense>}</Route>
      <Route path="/staff/events/scan">{() => <Suspense fallback={null}><StaffEventScan /></Suspense>}</Route>
      <Route path="/staff/pos">{() => <Suspense fallback={null}><StaffPos /></Suspense>}</Route>

      <Route path="/experiencias" component={Experiences} />
      <Route path="/experiencias/:slug" component={ExperienceDetail} />
      <Route path="/galeria" component={Gallery} />
      <Route path="/presupuesto" component={BudgetRequest} />
      <Route path="/colegios" component={Colegios} />
      <Route path="/canjear-cupon" component={CanjearCupon} />
      <Route path="/verificar-bono" component={VerificarBono} />
      <Route path="/registrar-gasto" component={RegistrarGasto} />
      <Route path="/solicitar-anulacion">{() => <Suspense fallback={<AdminLoadingFallback />}><SolicitarAnulacion /></Suspense>}</Route>
      <Route path="/presupuesto/:token" component={QuoteAcceptance} />
      <Route path="/propuesta/:token" component={ProposalView} />
      <Route path="/contacto" component={Contact} />
      <Route path="/ubicaciones" component={Locations} />
      <Route path="/ubicaciones/:slug" component={Locations} />
      <Route path="/lego-packs" component={LegoPacksHome} />
      <Route path="/lego-packs/detalle/:slug" component={LegoPackDetail} />
      <Route path="/lego-packs/:category" component={LegoPacksList} />
      <Route path="/hotel" component={Hotel} />
      <Route path="/hotel/:slug" component={HotelRoom} />
      <Route path="/spa" component={Spa} />
      <Route path="/spa/:slug" component={SpaDetail} />
      <Route path="/restaurantes" component={Restaurantes} />
      <Route path="/restaurantes/reserva-ok" component={RestauranteReservaOk} />
      <Route path="/restaurantes/reserva-ko" component={RestauranteReservaKo} />
      <Route path="/restaurantes/:slug" component={RestauranteDetail} />
      <Route path="/restaurantes/:slug/reservar" component={RestaurantBooking} />
      {/* ── CHECKOUT ROUTE ── */}
      <Route path="/checkout" component={Checkout} />
      {/* ── RESERVA ROUTES ── */}
      <Route path="/reserva/ok" component={ReservaOk} />
      <Route path="/reserva/error" component={ReservaError} />
      {/* ── AUTH ROUTES ── */}
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/recuperar-contrasena" component={ForgotPassword} />
      <Route path="/nueva-contrasena" component={ResetPassword} />
      <Route path="/establecer-contrasena" component={SetPassword} />

      {/* ── PARTNER PORTAL ── */}
      <Route path="/partner/activar">{() => <Suspense fallback={<AdminLoadingFallback />}><ActivarPartner /></Suspense>}</Route>
      <Route path="/partner/dashboard">{() => <Suspense fallback={<AdminLoadingFallback />}><PartnerDashboard /></Suspense>}</Route>
      <Route path="/partner/leads/nuevo">{() => <Suspense fallback={<AdminLoadingFallback />}><PartnerLeadNuevo /></Suspense>}</Route>
      <Route path="/partner/reservas/nueva">{() => <Suspense fallback={<AdminLoadingFallback />}><PartnerReservaNueva /></Suspense>}</Route>
      <Route path="/partner">{() => { window.location.replace("/partner/dashboard"); return null; }}</Route>

      {/* Portal de Proveedor */}
      <Route path="/supplier/activar">{() => <Suspense fallback={<AdminLoadingFallback />}><ActivarProveedor /></Suspense>}</Route>
      <Route path="/supplier/dashboard">{() => <Suspense fallback={<AdminLoadingFallback />}><SupplierDashboard /></Suspense>}</Route>
      <Route path="/supplier">{() => { window.location.replace("/supplier/dashboard"); return null; }}</Route>
      {/* ── LEGAL PAGES ── */}
      <Route path="/privacidad" component={PoliticaPrivacidad} />
      <Route path="/terminos" component={TerminosCondiciones} />
      <Route path="/cookies" component={PoliticaCookies} />
      <Route path="/condiciones-cancelacion" component={CondicionesCancelacion} />
      {/* ── DYNAMIC PAGES (CMS) ── */}
      <Route path="/pagina/:slug" component={DynamicPage} />

      {/* ── ADMIN ROUTES (lazy loaded) ── */}
      <Route path="/admin">
        {() => (
          <Suspense fallback={<AdminLoadingFallback />}>
            <AdminDashboard />
          </Suspense>
        )}
      </Route>

      {/* CMS */}
      <Route path="/admin/cms">{() => <Suspense fallback={<AdminLoadingFallback />}><SlideshowManager /></Suspense>}</Route>
      <Route path="/admin/cms/slideshow">{() => <Suspense fallback={<AdminLoadingFallback />}><SlideshowManager /></Suspense>}</Route>
      <Route path="/admin/cms/menus">{() => <Suspense fallback={<AdminLoadingFallback />}><MenusManager /></Suspense>}</Route>
      <Route path="/admin/cms/paginas">{() => <Suspense fallback={<AdminLoadingFallback />}><PagesManager /></Suspense>}</Route>
      <Route path="/admin/cms/multimedia">{() => <Suspense fallback={<AdminLoadingFallback />}><MultimediaManager /></Suspense>}</Route>
      <Route path="/admin/cms/modulos-home">{() => <Suspense fallback={<AdminLoadingFallback />}><HomeModulesManager /></Suspense>}</Route>
      <Route path="/admin/cms/galeria">{() => <Suspense fallback={<AdminLoadingFallback />}><GalleryManager /></Suspense>}</Route>
      <Route path="/admin/cms/inicio">{() => <Suspense fallback={<AdminLoadingFallback />}><SegolifeHomeManager /></Suspense>}</Route>

      {/* Products */}
      <Route path="/admin/productos">{() => <Suspense fallback={<AdminLoadingFallback />}><ExperiencesManager /></Suspense>}</Route>
      <Route path="/admin/productos/experiencias">{() => <Suspense fallback={<AdminLoadingFallback />}><ExperiencesManager /></Suspense>}</Route>
      <Route path="/admin/productos/categorias">{() => <Suspense fallback={<AdminLoadingFallback />}><CategoriesManager /></Suspense>}</Route>
      <Route path="/admin/productos/ubicaciones">{() => <Suspense fallback={<AdminLoadingFallback />}><LocationsManager /></Suspense>}</Route>
      <Route path="/admin/productos/variantes">{() => <Suspense fallback={<AdminLoadingFallback />}><VariantsManager /></Suspense>}</Route>
      <Route path="/admin/productos/lego-packs">{() => <Suspense fallback={<AdminLoadingFallback />}><LegoPacksManager /></Suspense>}</Route>

      {/* Quotes & Leads — redirigido al nuevo CRM */}
      <Route path="/admin/presupuestos">{() => { window.location.replace("/admin/crm"); return null; }}</Route>
      <Route path="/admin/presupuestos/leads">{() => { window.location.replace("/admin/crm"); return null; }}</Route>
      <Route path="/admin/presupuestos/lista">{() => { window.location.replace("/admin/crm"); return null; }}</Route>
      <Route path="/admin/presupuestos/nuevo">{() => { window.location.replace("/admin/crm"); return null; }}</Route>

      {/* Operations */}
      <Route path="/admin/operaciones">{() => <Suspense fallback={<AdminLoadingFallback />}><CalendarView /></Suspense>}</Route>
      <Route path="/admin/operaciones/calendario">{() => <Suspense fallback={<AdminLoadingFallback />}><CalendarView /></Suspense>}</Route>
      <Route path="/admin/operaciones/reservas">{() => <Suspense fallback={<AdminLoadingFallback />}><BookingsList /></Suspense>}</Route>
      <Route path="/admin/operaciones/actividades">{() => <Suspense fallback={<AdminLoadingFallback />}><DailyActivities /></Suspense>}</Route>
      {/* La gestión de empleados vive 100% en /admin/personal (Fase 10).
          La ruta histórica de Monitores redirige al módulo nuevo. */}
      <Route path="/admin/operaciones/monitores">{() => { window.location.replace("/admin/personal/empleados"); return null; }}</Route>
      <Route path="/admin/operaciones/reservas-redsys">{() => { window.location.replace("/admin/crm?tab=reservations"); return null; }}</Route>

      {/* Personal / RRHH (Fase 2) */}
      <Route path="/admin/personal">{() => <Suspense fallback={<AdminLoadingFallback />}><HRDashboard /></Suspense>}</Route>
      <Route path="/admin/personal/empleados">{() => <Suspense fallback={<AdminLoadingFallback />}><EmployeesList /></Suspense>}</Route>
      <Route path="/admin/personal/empleados/:id">{() => <Suspense fallback={<AdminLoadingFallback />}><EmployeeDetail /></Suspense>}</Route>
      <Route path="/admin/personal/fichajes">{() => <Suspense fallback={<AdminLoadingFallback />}><TimeClockManager /></Suspense>}</Route>
      {/* Fase 5: Nóminas y remesas */}
      <Route path="/admin/personal/nominas">{() => <Suspense fallback={<AdminLoadingFallback />}><PayslipsManager /></Suspense>}</Route>
      <Route path="/admin/personal/remesas">{() => <Suspense fallback={<AdminLoadingFallback />}><PayrollBatchesManager /></Suspense>}</Route>
      <Route path="/admin/personal/remesas/:id">{() => <Suspense fallback={<AdminLoadingFallback />}><BatchDetail /></Suspense>}</Route>
      <Route path="/admin/personal/bonus">{() => <Suspense fallback={<AdminLoadingFallback />}><BonusManager /></Suspense>}</Route>
      <Route path="/admin/personal/fiscal">{() => <Suspense fallback={<AdminLoadingFallback />}><HRFiscalLedger /></Suspense>}</Route>
      <Route path="/admin/personal/vacaciones">{() => <Suspense fallback={<AdminLoadingFallback />}><LeaveManager /></Suspense>}</Route>
      <Route path="/admin/personal/configuracion">{() => <Suspense fallback={<AdminLoadingFallback />}><HRSettings /></Suspense>}</Route>

      {/* Portal del Empleado (Fase 3) */}
      <Route path="/empleado">{() => <Suspense fallback={<AdminLoadingFallback />}><EmployeePortal /></Suspense>}</Route>
      <Route path="/empleado/fichar">{() => <Suspense fallback={<AdminLoadingFallback />}><MyTimeClock /></Suspense>}</Route>
      <Route path="/empleado/perfil">{() => <Suspense fallback={<AdminLoadingFallback />}><MyProfile /></Suspense>}</Route>
      <Route path="/empleado/nominas">{() => <Suspense fallback={<AdminLoadingFallback />}><MyPayslips /></Suspense>}</Route>
      <Route path="/empleado/documentos">{() => <Suspense fallback={<AdminLoadingFallback />}><MyDocuments /></Suspense>}</Route>
      <Route path="/empleado/vacaciones">{() => <Suspense fallback={<AdminLoadingFallback />}><MyLeaves /></Suspense>}</Route>
      <Route path="/empleado/activar">{() => <Suspense fallback={<AdminLoadingFallback />}><ActivarEmpleado /></Suspense>}</Route>

      {/* Accounting */}
      <Route path="/admin/contabilidad/control-diario">{() => <Suspense fallback={<AdminLoadingFallback />}><DailyControlCenter /></Suspense>}</Route>
      <Route path="/admin/contabilidad">{() => <Suspense fallback={<AdminLoadingFallback />}><AccountingDashboard /></Suspense>}</Route>
      <Route path="/admin/contabilidad/dashboard">{() => <Suspense fallback={<AdminLoadingFallback />}><AccountingDashboard /></Suspense>}</Route>
      <Route path="/admin/contabilidad/transacciones">{() => <Suspense fallback={<AdminLoadingFallback />}><TransactionsList /></Suspense>}</Route>
      <Route path="/admin/contabilidad/informes">{() => <Suspense fallback={<AdminLoadingFallback />}><AccountingReports /></Suspense>}</Route>
      <Route path="/admin/contabilidad/gastos">{() => <Suspense fallback={<AdminLoadingFallback />}><ExpensesManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/gastos/categorias">{() => <Suspense fallback={<AdminLoadingFallback />}><ExpenseCategoriesManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/gastos/proveedores">{() => <Suspense fallback={<AdminLoadingFallback />}><ExpenseSuppliersManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/gastos/centros-coste">{() => <Suspense fallback={<AdminLoadingFallback />}><CostCentersManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/gastos/recurrentes">{() => <Suspense fallback={<AdminLoadingFallback />}><RecurringExpensesManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/cuenta-resultados">{() => <Suspense fallback={<AdminLoadingFallback />}><ProfitLossReport /></Suspense>}</Route>
      <Route path="/admin/contabilidad/caja">{() => <Suspense fallback={<AdminLoadingFallback />}><CashRegisterManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/movimientos-bancarios">{() => <Suspense fallback={<AdminLoadingFallback />}><BankMovementsManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/operaciones-tpv">{() => <Suspense fallback={<AdminLoadingFallback />}><CardTerminalOperationsManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/remesas-tpv">{() => <Suspense fallback={<AdminLoadingFallback />}><CardTerminalBatchesManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/conciliacion-tpv">{() => <Suspense fallback={<AdminLoadingFallback />}><CardTerminalConciliationDashboard /></Suspense>}</Route>

      {/* Fiscal REAV */}
      <Route path="/admin/fiscal">{() => <Suspense fallback={<AdminLoadingFallback />}><ReavManager /></Suspense>}</Route>
      <Route path="/admin/fiscal/reav">{() => <Suspense fallback={<AdminLoadingFallback />}><ReavManager /></Suspense>}</Route>

      {/* Gestoría e Impuestos */}
      <Route path="/admin/gestoria">{() => <Suspense fallback={<AdminLoadingFallback />}><GestoriaDashboard /></Suspense>}</Route>
      <Route path="/admin/gestoria/iva">{() => <Suspense fallback={<AdminLoadingFallback />}><GestoriaIVA /></Suspense>}</Route>
      <Route path="/admin/gestoria/laboral">{() => <Suspense fallback={<AdminLoadingFallback />}><GestoriaLaboral /></Suspense>}</Route>
      <Route path="/admin/gestoria/sociedades">{() => <Suspense fallback={<AdminLoadingFallback />}><GestoriaSociedades /></Suspense>}</Route>
      <Route path="/admin/gestoria/expedientes">{() => <Suspense fallback={<AdminLoadingFallback />}><GestoriaExpedientes /></Suspense>}</Route>
      <Route path="/admin/gestoria/aplazamientos">{() => <Suspense fallback={<AdminLoadingFallback />}><GestoriaAplazamientos /></Suspense>}</Route>

      {/* Portal de Gestoría (rol gestoria, fuera de /admin) */}
      <Route path="/gestoria">{() => <Suspense fallback={<AdminLoadingFallback />}><GestoriaPortal /></Suspense>}</Route>
      <Route path="/gestoria/activar">{() => <Suspense fallback={<AdminLoadingFallback />}><ActivarGestoria /></Suspense>}</Route>
      <Route path="/admin/gestoria/calendario">{() => <Suspense fallback={<AdminLoadingFallback />}><GestoriaCalendario /></Suspense>}</Route>
      <Route path="/admin/gestoria/configuracion">{() => <Suspense fallback={<AdminLoadingFallback />}><GestoriaConfiguracion /></Suspense>}</Route>

      {/* Marketing */}
      <Route path="/admin/marketing">{() => <Suspense fallback={<AdminLoadingFallback />}><CuponesManager /></Suspense>}</Route>
      <Route path="/admin/marketing/cupones">{() => <Suspense fallback={<AdminLoadingFallback />}><CuponesManager /></Suspense>}</Route>
      <Route path="/admin/marketing/plataformas">{() => <Suspense fallback={<AdminLoadingFallback />}><PlatformsManager /></Suspense>}</Route>
      <Route path="/admin/marketing/descuentos">{() => <Suspense fallback={<AdminLoadingFallback />}><DiscountCodesManager /></Suspense>}</Route>
      <Route path="/admin/marketing/codigos-descuento">{() => <Suspense fallback={<AdminLoadingFallback />}><DiscountCodesManager /></Suspense>}</Route>

      {/* Suppliers & Settlements */}
      <Route path="/admin/suppliers">{() => <Suspense fallback={<AdminLoadingFallback />}><SuppliersManager /></Suspense>}</Route>
      <Route path="/admin/settlements">{() => <Suspense fallback={<AdminLoadingFallback />}><SettlementsManager /></Suspense>}</Route>

      {/* TPV */}
      <Route path="/admin/tpv">{() => <Suspense fallback={<AdminLoadingFallback />}><TpvScreen /></Suspense>}</Route>
      <Route path="/admin/tpv/cajas">{() => <Suspense fallback={<AdminLoadingFallback />}><TpvBackoffice /></Suspense>}</Route>
      <Route path="/admin/tpv/backoffice">{() => <Suspense fallback={<AdminLoadingFallback />}><TpvBackoffice /></Suspense>}</Route>

      {/* Hotel & SPA */}
      <Route path="/admin/hotel">{() => <Suspense fallback={<AdminLoadingFallback />}><HotelManager /></Suspense>}</Route>
      <Route path="/admin/spa">{() => <Suspense fallback={<AdminLoadingFallback />}><SpaManager /></Suspense>}</Route>

      {/* Reviews */}
      <Route path="/admin/operaciones/resenas">{() => <Suspense fallback={<AdminLoadingFallback />}><ReviewsManager /></Suspense>}</Route>

      {/* Restaurants Admin */}
      <Route path="/admin/restaurantes">{() => <Suspense fallback={<AdminLoadingFallback />}><RestaurantsManager /></Suspense>}</Route>
      <Route path="/admin/restaurantes/reservas">{() => <Suspense fallback={<AdminLoadingFallback />}><RestaurantsManager /></Suspense>}</Route>
      <Route path="/admin/restaurantes/calendario">{() => <Suspense fallback={<AdminLoadingFallback />}><GlobalCalendar /></Suspense>}</Route>
      <Route path="/admin/restaurantes/configuracion">{() => <Suspense fallback={<AdminLoadingFallback />}><RestaurantsManager /></Suspense>}</Route>

      {/* Atención Comercial */}
      <Route path="/admin/atencion-comercial/whatsapp">{() => <Suspense fallback={<AdminLoadingFallback />}><WhatsAppGHLInbox /></Suspense>}</Route>
      <Route path="/admin/atencion-comercial/agente-ia">{() => <Suspense fallback={<AdminLoadingFallback />}><VapiAgente /></Suspense>}</Route>
      <Route path="/admin/atencion-comercial/email">{() => <Suspense fallback={<AdminLoadingFallback />}><EmailInbox /></Suspense>}</Route>
      <Route path="/admin/atencion-comercial">{() => <Suspense fallback={<AdminLoadingFallback />}><CommercialFollowupDashboard /></Suspense>}</Route>

      {/* CRM */}
      <Route path="/admin/crm">{() => <Suspense fallback={<AdminLoadingFallback />}><CRMDashboard /></Suspense>}</Route>
      <Route path="/admin/plantillas-email">{() => <Suspense fallback={<AdminLoadingFallback />}><EngagementTemplatesViewer /></Suspense>}</Route>
      <Route path="/admin/partners">{() => <Suspense fallback={<AdminLoadingFallback />}><PartnersManager /></Suspense>}</Route>
      <Route path="/admin/partners/facturacion">{() => <Suspense fallback={<AdminLoadingFallback />}><PartnerBillingManager /></Suspense>}</Route>
      <Route path="/admin/crm/leads">{() => <Suspense fallback={<AdminLoadingFallback />}><CRMDashboard /></Suspense>}</Route>
      <Route path="/admin/crm/presupuestos">{() => <Suspense fallback={<AdminLoadingFallback />}><CRMDashboard /></Suspense>}</Route>
      <Route path="/admin/crm/reservas">{() => <Suspense fallback={<AdminLoadingFallback />}><CRMDashboard /></Suspense>}</Route>
      <Route path="/admin/crm/clientes">{() => <Suspense fallback={<AdminLoadingFallback />}><ClientsManager /></Suspense>}</Route>
      <Route path="/admin/crm/propuestas">{() => <Suspense fallback={<AdminLoadingFallback />}><ProposalsPage /></Suspense>}</Route>
      <Route path="/admin/crm/anulaciones">{() => { window.location.replace("/admin/crm"); return null; }}</Route>

      {/* Users & Settings */}
      <Route path="/admin/usuarios">{() => <Suspense fallback={<AdminLoadingFallback />}><UsersManager /></Suspense>}</Route>
      <Route path="/admin/students">{() => <Suspense fallback={<AdminLoadingFallback />}><StudentsManager /></Suspense>}</Route>
      {/* Rutas literales ANTES de /admin/students/:id — wouter hace match en orden y ":id" capturaría "historical" si fuera declarada después. */}
      <Route path="/admin/students/historical">{() => <Suspense fallback={<AdminLoadingFallback />}><HistoricalIdentities /></Suspense>}</Route>
      <Route path="/admin/students/historical/:identityKey">{() => <Suspense fallback={<AdminLoadingFallback />}><HistoricalIdentityDetail /></Suspense>}</Route>
      <Route path="/admin/students/:id">{() => <Suspense fallback={<AdminLoadingFallback />}><StudentDetail /></Suspense>}</Route>
      <Route path="/admin/venues">{() => <Suspense fallback={<AdminLoadingFallback />}><VenuesManager /></Suspense>}</Route>
      <Route path="/admin/venues/:id">{() => <Suspense fallback={<AdminLoadingFallback />}><VenueDetail /></Suspense>}</Route>
      <Route path="/admin/events">{() => <Suspense fallback={<AdminLoadingFallback />}><EventsManager /></Suspense>}</Route>
      <Route path="/admin/events/new">{() => <Suspense fallback={<AdminLoadingFallback />}><EventCreate /></Suspense>}</Route>
      <Route path="/admin/events/:id">{() => <Suspense fallback={<AdminLoadingFallback />}><EventDetail /></Suspense>}</Route>
      <Route path="/admin/tokens">{() => <Suspense fallback={<AdminLoadingFallback />}><TokensDashboard /></Suspense>}</Route>
      <Route path="/admin/tokens/rules">{() => <Suspense fallback={<AdminLoadingFallback />}><TokensRulesManager /></Suspense>}</Route>
      <Route path="/admin/tokens/campaigns">{() => <Suspense fallback={<AdminLoadingFallback />}><TokensCampaignsManager /></Suspense>}</Route>
      <Route path="/admin/qr">{() => <Suspense fallback={<AdminLoadingFallback />}><QrManager /></Suspense>}</Route>
      <Route path="/admin/benefits">{() => <Suspense fallback={<AdminLoadingFallback />}><BenefitsManager /></Suspense>}</Route>
      <Route path="/admin/engagement/campaigns">{() => <Suspense fallback={<AdminLoadingFallback />}><EngagementCampaignsManager /></Suspense>}</Route>
      <Route path="/admin/engagement/notifications">{() => <Suspense fallback={<AdminLoadingFallback />}><EngagementNotificationsLog /></Suspense>}</Route>
      <Route path="/admin/engagement/deliveries">{() => <Suspense fallback={<AdminLoadingFallback />}><EngagementDeliveriesLog /></Suspense>}</Route>
      <Route path="/admin/engagement/templates">{() => <Suspense fallback={<AdminLoadingFallback />}><EngagementTemplatesViewer /></Suspense>}</Route>
      <Route path="/admin/engagement/audience">{() => <Suspense fallback={<AdminLoadingFallback />}><EngagementAudiencePage /></Suspense>}</Route>
      <Route path="/admin/comunity/nueva">{() => <Suspense fallback={<AdminLoadingFallback />}><ComunityWizard /></Suspense>}</Route>
      <Route path="/admin/comunity/moderacion">{() => <Suspense fallback={<AdminLoadingFallback />}><ComunityModeration /></Suspense>}</Route>
      <Route path="/admin/comunity/:id">{() => <Suspense fallback={<AdminLoadingFallback />}><ComunityDetail /></Suspense>}</Route>
      <Route path="/admin/comunity">{() => <Suspense fallback={<AdminLoadingFallback />}><ComunityManager /></Suspense>}</Route>
      <Route path="/admin/integrations/unresolved">{() => <Suspense fallback={<AdminLoadingFallback />}><UnresolvedOperations /></Suspense>}</Route>
      <Route path="/admin/integrations">{() => <Suspense fallback={<AdminLoadingFallback />}><IntegrationsManager /></Suspense>}</Route>
      <Route path="/admin/configuracion">{() => <Suspense fallback={<AdminLoadingFallback />}><ConfigPanel /></Suspense>}</Route>
      <Route path="/admin/configuracion/sitio">{() => <Suspense fallback={<AdminLoadingFallback />}><Settings /></Suspense>}</Route>
      <Route path="/admin/configuracion/estado">{() => <Suspense fallback={<AdminLoadingFallback />}><ConfigStatus /></Suspense>}</Route>
      <Route path="/admin/configuracion/avanzado">{() => <Suspense fallback={<AdminLoadingFallback />}><AdvancedSettings /></Suspense>}</Route>
      <Route path="/admin/configuracion/email">{() => <Suspense fallback={<AdminLoadingFallback />}><EmailAccountsSettings /></Suspense>}</Route>
      <Route path="/admin/onboarding">{() => <Suspense fallback={<AdminLoadingFallback />}><OnboardingWizard /></Suspense>}</Route>
      <Route path="/admin/numeracion">{() => <Suspense fallback={<AdminLoadingFallback />}><DocumentNumbersAdmin /></Suspense>}</Route>

      {/* ── SEGOLIFE: rutas dinámicas de comunidad (Fase 6) ──────────────────────
          Deliberadamente al final del Switch (justo antes del 404): `/:community`
          es un patrón genérico de un solo segmento que podría confundirse con
          cualquier ruta literal (/login, /experiencias, etc.) si se declarase
          antes — así, cualquier ruta más específica ya declarada arriba gana
          siempre. La resolución real de comunidad (¿"ie" existe de verdad?)
          la hace SegolifeAppShell/CommunityContext consultando la API, nunca
          aquí — esto es solo la forma de la URL. Compatible con las rutas ya
          en producción (/ie/scan, /ie/benefits, etc. siguen funcionando
          exactamente igual, ahora servidas por el mismo patrón dinámico). */}
      <Route path="/:community/events/:slug">{() => <Suspense fallback={null}><SegolifeEventDetail /></Suspense>}</Route>
      <Route path="/:community/venues/:slug">{() => <Suspense fallback={null}><SegolifeVenueDetail /></Suspense>}</Route>
      <Route path="/:community/explore">{() => <Suspense fallback={null}><Explore /></Suspense>}</Route>
      <Route path="/:community/scan">{() => <Suspense fallback={null}><StudentScan /></Suspense>}</Route>
      <Route path="/:community/benefits/:id">{() => <Suspense fallback={null}><BenefitDetail /></Suspense>}</Route>
      <Route path="/:community/benefits">{() => <Suspense fallback={null}><Rewards /></Suspense>}</Route>
      <Route path="/:community/rewards">{() => <Suspense fallback={null}><Rewards /></Suspense>}</Route>
      <Route path="/:community/activity">{() => <Suspense fallback={null}><Activity /></Suspense>}</Route>
      <Route path="/:community/settings/notifications">{() => <Suspense fallback={null}><NotificationPreferences /></Suspense>}</Route>
      <Route path="/:community/notifications">{() => <Suspense fallback={null}><SegolifeNotifications /></Suspense>}</Route>
      <Route path="/:community/checkout/:orderId">{() => <Suspense fallback={null}><TicketCheckout /></Suspense>}</Route>
      <Route path="/:community/tickets/:id">{() => <Suspense fallback={null}><TicketDetail /></Suspense>}</Route>
      <Route path="/:community/tickets">{() => <Suspense fallback={null}><MyTickets /></Suspense>}</Route>
      <Route path="/:community/profile">{() => <Suspense fallback={null}><SegolifeProfile /></Suspense>}</Route>
      <Route path="/:community/comunity/:id">{() => <Suspense fallback={null}><ComunityQuestionDetail /></Suspense>}</Route>
      <Route path="/:community/comunity">{() => <Suspense fallback={null}><ComunityHub /></Suspense>}</Route>
      <Route path="/:community">{() => <Suspense fallback={null}><SegolifeHome /></Suspense>}</Route>

      {/* 404 */}
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        {/* CommunityProvider sí envuelve toda la app (barato: solo consulta
            si la URL es potencialmente de comunidad, ver
            shared/segolife/routing.ts). AdminCommunityProvider envuelve toda
            la app por necesidad estructural (páginas como StudentsManager
            llaman a useAdminCommunity() antes de renderizar <AdminLayout>,
            así que el provider no puede vivir dentro de AdminLayout — un
            descendiente no puede proveer contexto a su propio ancestro); su
            query `communities.list` solo se activa en rutas /admin (ver
            AdminCommunityContext.tsx), así que sigue sin dispararse en
            páginas públicas. */}
        <CommunityProvider>
          <AdminCommunityProvider>
            <TooltipProvider>
              <Toaster richColors position="top-right" />
              <ScrollToTop />
              <MaintenanceGate>
                <Router />
              </MaintenanceGate>
              <CookieBanner />
              <MetaPixelLoader />
              <GA4Loader />
            </TooltipProvider>
          </AdminCommunityProvider>
        </CommunityProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
