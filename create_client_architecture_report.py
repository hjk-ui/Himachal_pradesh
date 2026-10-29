from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas
import os


OUT = "/Users/kartiksetia/Documents/ChatGPT/dd/output/pdf/divinecare-client-architecture-review.pdf"
os.makedirs(os.path.dirname(OUT), exist_ok=True)

PAGE_W, PAGE_H = A4
NAVY = colors.HexColor("#12304A")
BLUE = colors.HexColor("#1E6A8D")
TEAL = colors.HexColor("#16817A")
PALE_BLUE = colors.HexColor("#EAF4F8")
PALE_TEAL = colors.HexColor("#EAF7F4")
PALE_AMBER = colors.HexColor("#FFF5DE")
AMBER = colors.HexColor("#B66A00")
RED = colors.HexColor("#A3342F")
PALE_RED = colors.HexColor("#FCEDEB")
INK = colors.HexColor("#24323D")
MUTED = colors.HexColor("#667783")
LINE = colors.HexColor("#D6E0E5")
WHITE = colors.white


def register_fonts():
    candidates = [
        ("Inter", "/System/Library/Fonts/Supplemental/Arial.ttf"),
        ("Inter-Bold", "/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        ("Inter-Italic", "/System/Library/Fonts/Supplemental/Arial Italic.ttf"),
    ]
    for name, path in candidates:
        if os.path.exists(path):
            pdfmetrics.registerFont(TTFont(name, path))
    return "Inter" if "Inter" in pdfmetrics.getRegisteredFontNames() else "Helvetica"


FONT = register_fonts()
BOLD = "Inter-Bold" if "Inter-Bold" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Bold"
ITALIC = "Inter-Italic" if "Inter-Italic" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Oblique"


styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="CoverTitle", fontName=BOLD, fontSize=28, leading=33, textColor=WHITE,
    alignment=TA_LEFT, spaceAfter=10,
))
styles.add(ParagraphStyle(
    name="CoverSub", fontName=FONT, fontSize=13, leading=19, textColor=colors.HexColor("#D7EEF4"),
))
styles.add(ParagraphStyle(
    name="H1x", fontName=BOLD, fontSize=19, leading=24, textColor=NAVY, spaceBefore=2, spaceAfter=11,
))
styles.add(ParagraphStyle(
    name="H2x", fontName=BOLD, fontSize=13.5, leading=18, textColor=NAVY, spaceBefore=8, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="Bodyx", fontName=FONT, fontSize=9.5, leading=14.2, textColor=INK, spaceAfter=7,
))
styles.add(ParagraphStyle(
    name="Smallx", fontName=FONT, fontSize=8, leading=11, textColor=MUTED,
))
styles.add(ParagraphStyle(
    name="Bulletx", fontName=FONT, fontSize=9.3, leading=13.8, leftIndent=13, firstLineIndent=-8,
    bulletIndent=2, textColor=INK, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="Layman", fontName=FONT, fontSize=9.3, leading=13.8, textColor=colors.HexColor("#164E49"),
))
styles.add(ParagraphStyle(
    name="Evidence", fontName=FONT, fontSize=7.4, leading=10.4, textColor=MUTED,
))
styles.add(ParagraphStyle(
    name="Quote", fontName=ITALIC, fontSize=11, leading=17, leftIndent=9, rightIndent=9,
    textColor=NAVY,
))


def footer(canvas: Canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(18 * mm, 14 * mm, PAGE_W - 18 * mm, 14 * mm)
    canvas.setFont(FONT, 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 9.2 * mm, "DivineCare Platform - Technical Architecture Review")
    canvas.drawRightString(PAGE_W - 18 * mm, 9.2 * mm, f"Page {doc.page}")
    canvas.restoreState()


def cover(canvas: Canvas, doc):
    canvas.saveState()
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    canvas.setFillColor(BLUE)
    canvas.circle(PAGE_W - 18 * mm, PAGE_H - 20 * mm, 52 * mm, fill=1, stroke=0)
    canvas.setFillColor(TEAL)
    canvas.circle(PAGE_W - 5 * mm, PAGE_H - 6 * mm, 25 * mm, fill=1, stroke=0)
    canvas.setStrokeColor(colors.HexColor("#66C7C1"))
    canvas.setLineWidth(2)
    canvas.line(20 * mm, 30 * mm, 75 * mm, 30 * mm)
    canvas.restoreState()


doc = BaseDocTemplate(
    OUT,
    pagesize=A4,
    rightMargin=18 * mm,
    leftMargin=18 * mm,
    topMargin=18 * mm,
    bottomMargin=19 * mm,
    title="DivineCare Platform - Client Code Architecture and Production Readiness Review",
    author="Senior Software Architecture Review",
    subject="Security, scalability, data integrity, reliability and production readiness",
)
cover_frame = Frame(18 * mm, 22 * mm, PAGE_W - 36 * mm, PAGE_H - 44 * mm, id="cover")
body_frame = Frame(18 * mm, 18 * mm, PAGE_W - 36 * mm, PAGE_H - 36 * mm, id="body")
doc.addPageTemplates([
    PageTemplate(id="Cover", frames=[cover_frame], onPage=cover),
    PageTemplate(id="Body", frames=[body_frame], onPage=footer),
])


story = []


def p(text, style="Bodyx"):
    story.append(Paragraph(text, styles[style]))


def bullet(text):
    story.append(Paragraph(text, styles["Bulletx"], bulletText="•"))


def layman(text):
    box = Table([[Paragraph("PLAIN-ENGLISH EXPLANATION", ParagraphStyle(
        "lbl", parent=styles["Smallx"], fontName=BOLD, textColor=TEAL, spaceAfter=3
    )), Paragraph(text, styles["Layman"])]], colWidths=[41 * mm, 124 * mm])
    box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PALE_TEAL),
        ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#AEDBD5")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.append(box)
    story.append(Spacer(1, 7))


def finding(num, severity, title, technical, plain, evidence, impact=None):
    sev_color = RED if severity == "CRITICAL" else AMBER if severity == "HIGH" else BLUE
    head = Table([
        [Paragraph(f"{num}", ParagraphStyle("num", fontName=BOLD, fontSize=13, textColor=WHITE, alignment=TA_CENTER)),
         Paragraph(title, styles["H2x"]),
         Paragraph(severity, ParagraphStyle("sev", fontName=BOLD, fontSize=7.5, textColor=sev_color, alignment=TA_CENTER))]
    ], colWidths=[10 * mm, 128 * mm, 27 * mm])
    head.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), sev_color),
        ("BACKGROUND", (2, 0), (2, 0), PALE_RED if severity == "CRITICAL" else PALE_AMBER if severity == "HIGH" else PALE_BLUE),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (1, 0), (1, 0), 8),
        ("RIGHTPADDING", (1, 0), (1, 0), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    items = [head, Spacer(1, 6), Paragraph(technical, styles["Bodyx"])]
    if impact:
        items.append(Paragraph(f"<b>Business impact:</b> {impact}", styles["Bodyx"]))
    items.append(Table([[Paragraph("PLAIN-ENGLISH EXPLANATION", ParagraphStyle(
        "lbl2", parent=styles["Smallx"], fontName=BOLD, textColor=TEAL
    )), Paragraph(plain, styles["Layman"])]], colWidths=[41 * mm, 124 * mm], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PALE_TEAL),
        ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#AEDBD5")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ])))
    items.extend([Spacer(1, 4), Paragraph(f"<b>Code evidence:</b> {evidence}", styles["Evidence"]), Spacer(1, 9)])
    story.append(KeepTogether(items))


# Cover
story.append(Spacer(1, 44 * mm))
p("DIVINECARE PLATFORM", "CoverSub")
p("Client Code Architecture &<br/>Production Readiness Review", "CoverTitle")
story.append(Spacer(1, 8 * mm))
p("A senior engineering assessment of security, scalability, data integrity, reliability and operational readiness - with plain-English explanations for business stakeholders.", "CoverSub")
story.append(Spacer(1, 72 * mm))
p("Review date: 28 October 2026", "CoverSub")
p("Scope: divinecare-platform-altrixs-staging source snapshot", "CoverSub")
story.append(NextPageTemplate("Body"))
story.append(PageBreak())


# Executive summary
p("Executive summary", "H1x")
p("The reviewed codebase contains substantial feature development and several thoughtful safeguards. The principal concern is not whether screens and functions exist. The concern is whether the entire healthcare platform can be operated securely, consistently and recoverably in production.")
p("The review identified risks in real-time authorization, multi-server scalability, deployment resilience, database change control, automated testing, role enforcement, file storage, scheduled jobs and failure visibility. These are system-level responsibilities that remain after feature development is considered complete.")

summary_data = [
    [Paragraph("Area", styles["Smallx"]), Paragraph("Observed condition", styles["Smallx"]), Paragraph("Risk", styles["Smallx"])],
    ["Real-time messaging", "Unauthenticated socket design if enabled", "Critical"],
    ["Scalability", "Process-local events and single-server coupling", "High"],
    ["Database", "Prisma plus raw SQL and manual baseline history", "High"],
    ["Testing", "No real database/integrations in CI; tests omitted", "High"],
    ["Authorization", "Policy spread across hundreds of API handlers", "High"],
    ["Operations", "Host cron, local files and limited failure visibility", "High"],
]
tbl = Table(summary_data, colWidths=[39 * mm, 97 * mm, 29 * mm], repeatRows=1)
tbl.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), NAVY),
    ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
    ("FONTNAME", (0, 0), (-1, 0), BOLD),
    ("FONTNAME", (0, 1), (-1, -1), FONT),
    ("FONTSIZE", (0, 1), (-1, -1), 8.4),
    ("LEADING", (0, 1), (-1, -1), 11),
    ("GRID", (0, 0), (-1, -1), 0.5, LINE),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, colors.HexColor("#F7FAFB")]),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
]))
story.append(tbl)
story.append(Spacer(1, 10))
layman("The product may look nearly finished from the outside, but the behind-the-scenes safety systems still need specialist work. It is similar to finishing the rooms of a hospital before validating the fire system, backup power, access controls and emergency procedures.")
p("Recommended engagement", "H2x")
p("Stop open-ended feature development if that is the client's preference, but retain an accountable senior engineering team for architecture hardening, security validation, database reconciliation, integration testing and production release certification.")
story.append(PageBreak())


p("Key technical findings", "H1x")
finding(
    1, "CRITICAL", "Real-time messaging is not safely authenticated if enabled",
    "The Socket.IO server accepts connections from any origin, trusts a user object supplied by the browser and permits a caller to join a room by supplying a thread ID. The server does not independently verify the session, the claimed identity or membership of the requested conversation. The feature is disabled by default because the current Next.js production server arrangement cannot initialize it correctly, but switching it on without redesign would create an authorization exposure.",
    "A person should only be able to enter a chat room after the server checks their identity and confirms that the room belongs to them. Here, the proposed socket design accepts the name and room number supplied by the browser. It is like letting a visitor write their own ID badge and choose which consultation room to enter.",
    "src/lib/socket/server.ts lines 25-96; src/features/messages/hooks/useSocketChat.ts lines 44-72; src/app/api/socket/io/route.ts lines 6-27.",
    "Potential unauthorized exposure of message events and presence data if the configuration is enabled without additional controls."
)
finding(
    2, "HIGH", "Real-time delivery is tied to one Node.js process",
    "Message events are distributed through an in-memory EventEmitter stored on globalThis. This event bus is not shared between application instances and is cleared by restarts. The optional Pusher publication is fire-and-forget and silently suppresses delivery failures. This architecture cannot guarantee consistent event delivery when the application is scaled horizontally or restarted.",
    "Each server keeps its own private notice board. If two users are connected to different servers, a notice placed on one board may never appear on the other. Restarting the server clears the board completely.",
    "src/lib/messages/realtime.ts lines 35-101 and 72-82.",
    "Missed or inconsistent message notifications, especially during scaling, deployment or transient network failure."
)
finding(
    3, "HIGH", "The current environment has a single-server failure domain",
    "The staging runbook documents one EC2 application instance, PM2 restart deployment, locally configured cron jobs and filesystem-based uploads. These components share the availability of the same host. A host failure can affect the portal, scheduled integrations, message streams and document access together.",
    "Too many essential functions depend on one machine. If that machine stops, the website, scheduled work and some file access can stop at the same time. A production healthcare system needs another route when one machine fails.",
    "DEPLOY.md lines 3-15 and 51-69; deploy/crontab.staging.",
    "Extended outage and delayed clinical or billing integrations during instance failure or maintenance."
)
finding(
    4, "HIGH", "Database change control has two sources of truth",
    "The codebase contains a 9,244-line Prisma schema with approximately 320 models plus more than 100 SQL migration files. The deployment documentation confirms that some database structures exist only in SQL and warns that Prisma db push could remove them. It also records that earlier staging changes were hand-applied and later baselined. The migration script has no concurrency lock.",
    "The application's map of the database does not show every road. Some changes are recorded in one system and other changes in another. If an engineer follows only one map, valid information can be removed or the database can end up in a state that the code does not expect.",
    "prisma/schema.prisma; DEPLOY.md lines 29-36, 75-89 and 122-141.",
    "Schema drift, failed deployments, difficult rollback and possible loss or misinterpretation of clinical and billing data."
)
story.append(PageBreak())


finding(
    5, "HIGH", "CI does not exercise the actual database or external integrations",
    "The CI workflow explicitly states that its build and tests never connect to a database or integration. Passing CI therefore does not validate migrations, PostgreSQL behavior, DrFirst, Waystar, Stripe, AWS, Chime, HealthLake, email or SMS as a complete deployed workflow.",
    "The automated checks test many individual parts on a workbench, but they do not start the complete machine with its real connections. A green check mark does not prove that a prescription, claim, payment or clinical workflow will complete in production.",
    ".github/workflows/ci.yml lines 19-27 and 46-63.",
    "Integration defects can remain undiscovered until staging or production."
)
finding(
    6, "HIGH", "Important test files are outside the normal CI test command",
    "The npm test script names test files individually rather than discovering the test suite automatically. Thirteen top-level tests are omitted, including security hardening, role separation, registration persistence, treatment-team access, onboarding verification and Valant repair integration tests.",
    "Some safety inspections have been written, but the normal automated process does not actually run them. Their existence can make the test coverage look stronger than the protection provided by each release.",
    "package.json script test; omitted files include security-hardening-oct18.test.ts, role-separation-billing-office.test.ts and registration-persistence.test.ts.",
    "Security or persistence regressions may not block a release."
)
finding(
    7, "HIGH", "Known lint failures are allowed to pass",
    "The CI lint step uses continue-on-error and is described as non-blocking until existing errors are fixed. A release can therefore receive a successful CI result while still containing known quality violations.",
    "The inspection process finds problems but is instructed not to stop the release. Before production, critical inspections should be mandatory, not advisory.",
    ".github/workflows/ci.yml lines 55-57.",
    "Known defects and unsafe patterns can accumulate without a release gate."
)
finding(
    8, "HIGH", "Authorization rules are distributed across a very large API surface",
    "The application contains approximately 799 API route handlers and about 1,796 direct role-string occurrences. Authorization is implemented through central gates in some routes, patient-specific handlers in others and local role sets elsewhere. This distribution makes it difficult to prove that every read and write operation applies the same tenant, patient and role policy.",
    "There are hundreds of doors, and the rules for who may enter are written beside many individual doors instead of being controlled by one consistent security desk. Over time, one door can easily receive a different rule or miss an update.",
    "src/app/api route inventory; local role example in src/app/api/medical/payer-settings/route.ts.",
    "Permission drift, inconsistent tenant isolation and expensive access-control review."
)
story.append(PageBreak())


finding(
    9, "HIGH", "Some infrastructure failures are converted into normal-looking results",
    "Several workflows suppress exceptions or return fallbacks. In the medication route, failure to load fill events is ignored and the response can use normal-looking adherence defaults such as dispensed and ok. Pusher failures are silently discarded. Location database failure can return an empty fallback list. Operational failure should be represented as unknown or unavailable, not as successful clinical state.",
    "If the system cannot retrieve an answer, it sometimes shows a normal answer instead of warning that the information is unavailable. In healthcare and billing, 'we could not check' must never look like 'everything is fine.'",
    "src/app/api/clinical/medications/route.ts lines 101-115 and 143-146; src/lib/messages/realtime.ts lines 78-82; src/app/api/locations/route.ts lines 42-56.",
    "Users may make decisions using stale or incorrectly reassuring information."
)
finding(
    10, "HIGH", "Patient API CORS configuration fails open",
    "The shared patient response layer defaults Access-Control-Allow-Origin to * when PATIENT_CORS_ORIGIN is absent. This behavior is used across dozens of patient API files. While native mobile bearer-token APIs may require broad access, a wildcard is not a safe default for browser-accessible healthcare endpoints. Production should validate exact origins at startup and refuse unsafe configuration.",
    "If an important website access list is missing, the application currently changes the rule to 'allow every website.' A safer approach is to stop and request the correct list.",
    "src/patient/infrastructure/http/response.ts lines 5-13; docs/production-cutover-plan.md requires exact origins.",
    "Unnecessary browser exposure if an environment variable is omitted or misconfigured."
)
finding(
    11, "HIGH", "Private documents are coupled to filesystem storage",
    "Clinical documents, consents, credentials, intake documents, resources and avatars are written beneath UPLOADS_DIR. This requires a correctly mounted shared filesystem for multi-server operation and coordinated backup between database records and file contents. The production plan proposes EFS, but deployment, encryption, backup, malware scanning and restoration must be implemented and proven.",
    "The database remembers where a document should be, while the document itself lives on a disk. If the disk, mount or backup is wrong, the record may remain but the actual clinical document may be missing.",
    "src/lib/storage/privateUploads.ts; document and consent storage modules; docs/production-cutover-plan.md.",
    "Missing files, inconsistent restore, scaling constraints and compliance exposure."
)
finding(
    12, "HIGH", "Critical scheduled work depends on machine-level cron",
    "DrFirst synchronization, Waystar retrieval, consent reminders, eligibility checks and other jobs are configured through /etc/cron.d on the application host. The configuration contains an unresolved TODO to verify duplicate jobs and server log paths. The jobs use different locking approaches and there is no demonstrated centralized retry, dead-letter or alerting system.",
    "Important background work depends on one computer's alarm clock. If the computer is replaced, misconfigured or unavailable, the alarm may not ring and the business may not immediately know which tasks were missed.",
    "deploy/crontab.staging lines 1-55.",
    "Delayed prescriptions, claims, eligibility results, reminders or synchronizations without immediate detection."
)
story.append(PageBreak())


finding(
    13, "MEDIUM", "Test quantity overstates executed workflow coverage",
    "At least 132 of 221 top-level test files read source files or check textual patterns. These guardrails can be useful, but they do not render the interface, execute a browser journey, connect to PostgreSQL or prove that authorization and multi-step clinical workflows behave correctly at runtime.",
    "Many tests check that the instruction label exists, rather than asking a person to follow the instruction and confirming the result. Both types are useful, but they provide different levels of confidence.",
    "tests/layout-static-guards-business.test.ts explicitly states that its checks do not render anything.",
    "Stakeholders may interpret a high test count as stronger production assurance than it provides."
)
finding(
    14, "MEDIUM", "The modular monolith has outgrown informal boundaries",
    "The branch contains approximately 583,000 JavaScript and TypeScript lines, 799 API handlers, 320 data models and multiple page components between 2,000 and 3,300 lines. A monolith can be appropriate, but at this scale it needs enforced module ownership, dependency rules, smaller use-case services and documented contracts.",
    "The application has become a very large building with many departments sharing walls and wiring. A small repair in one department can unexpectedly affect another unless the boundaries are deliberately engineered and tested.",
    "Examples include appointments/page.tsx, clients/[id]/page.tsx, notes/page.tsx, telehealth/page.tsx and communications/page.tsx.",
    "Slower changes, larger regression surface, difficult onboarding and high dependence on a few people."
)


p("What the client should understand", "H1x")
story.append(Table([[Paragraph(
    "Feature completion is not the same as production readiness. The remaining work is less visible than building screens, but it is the work that protects patient information, prevents data loss and keeps the service available when something fails.",
    styles["Quote"]
)]], colWidths=[165 * mm], style=TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), PALE_BLUE),
    ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#B7D5E1")),
    ("LEFTPADDING", (0, 0), (-1, -1), 11),
    ("RIGHTPADDING", (0, 0), (-1, -1), 11),
    ("TOPPADDING", (0, 0), (-1, -1), 11),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 11),
])))
story.append(Spacer(1, 10))
p("Why continued senior engineering involvement is justified", "H2x")
bullet("Security ownership: redesign socket authentication, review patient API exposure and produce an auditable endpoint-permission matrix.")
bullet("Data ownership: reconcile Prisma and SQL, test every migration against a realistic database copy and introduce deployment locking.")
bullet("Reliability ownership: remove single-host dependencies, establish shared storage and introduce durable event and job processing.")
bullet("Quality ownership: run all tests automatically, make lint and security gates mandatory and add database-backed integration tests.")
bullet("Operational ownership: add centralized metrics, alerts, job monitoring, integration dashboards and tested recovery procedures.")
story.append(PageBreak())


p("Recommended stabilization engagement", "H1x")
phases = [
    ("1", "Security and access control", "Inventory all APIs; verify tenant and patient scope; replace client-trusted socket identity; lock CORS configuration; test protected-record controls."),
    ("2", "Database assurance", "Reconcile Prisma with raw SQL; verify the migration ledger; test on a production-like clone; implement locking and recovery drills."),
    ("3", "Reliability engineering", "Introduce a durable event/job layer, shared encrypted document storage, centralized monitoring, retry policies and failure alerts."),
    ("4", "Release certification", "Execute real PostgreSQL integration tests and end-to-end clinical, billing, prescribing, communication and recovery scenarios."),
]
phase_rows = [[Paragraph("Phase", styles["Smallx"]), Paragraph("Workstream", styles["Smallx"]), Paragraph("Outcome", styles["Smallx"])]]
for n, name, outcome in phases:
    phase_rows.append([Paragraph(n, ParagraphStyle("phase", fontName=BOLD, fontSize=13, textColor=TEAL, alignment=TA_CENTER)), Paragraph(f"<b>{name}</b>", styles["Bodyx"]), Paragraph(outcome, styles["Bodyx"])])
phase_table = Table(phase_rows, colWidths=[16 * mm, 49 * mm, 100 * mm], repeatRows=1)
phase_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), NAVY),
    ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
    ("GRID", (0, 0), (-1, -1), 0.5, LINE),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, colors.HexColor("#F7FAFB")]),
    ("LEFTPADDING", (0, 0), (-1, -1), 7),
    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
]))
story.append(phase_table)
story.append(Spacer(1, 12))
p("Suggested client-facing statement", "H2x")
story.append(Table([[Paragraph(
    "We recognize the significant feature development already completed. We are not proposing unnecessary additional screens. Our review shows that the platform has reached a level of complexity where production safety depends on architecture, security and operational engineering. The remaining risks include real-time authorization, database change control, multi-server reliability, scheduled integration processing, file durability and test coverage against real infrastructure. We propose moving from open-ended development to a defined stabilization and production-assurance engagement with measurable acceptance criteria.",
    styles["Quote"]
)]], colWidths=[165 * mm], style=TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), PALE_TEAL),
    ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#AEDBD5")),
    ("LEFTPADDING", (0, 0), (-1, -1), 11),
    ("RIGHTPADDING", (0, 0), (-1, -1), 11),
    ("TOPPADDING", (0, 0), (-1, -1), 11),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 11),
])))
story.append(Spacer(1, 12))
p("Proposed acceptance evidence", "H2x")
bullet("Signed API authorization matrix covering tenant, role and patient scope.")
bullet("Database migration rehearsal with before-and-after reconciliation and recovery evidence.")
bullet("All test files discovered automatically and mandatory quality gates passing.")
bullet("Database-backed integration suite for critical clinical and billing paths.")
bullet("Authenticated, multi-instance-safe messaging and background processing.")
bullet("Documented recovery targets, monitoring dashboards and actionable alerts.")
story.append(PageBreak())


p("Review scope and limitations", "H1x")
p("This report is based on static inspection of the supplied divinecare-platform-altrixs-staging source snapshot. No production credentials, production database, live infrastructure or external vendor environments were used. Findings describe code and documented architecture present in the snapshot; they do not claim that every planned production control is absent from infrastructure outside the repository.")
p("Security findings should be confirmed through controlled runtime testing. The objective is risk reduction and release assurance, not criticism of the amount of development completed.")
p("Evidence index", "H2x")
evidence_rows = [
    ["Area", "Primary repository evidence"],
    ["Socket authorization", "src/lib/socket/server.ts; src/features/messages/hooks/useSocketChat.ts"],
    ["Message scaling", "src/lib/messages/realtime.ts"],
    ["Deployment", "DEPLOY.md; deploy/codebuild; deploy/crontab.staging"],
    ["Database", "prisma/schema.prisma; prisma/migrations; scripts/migrate.sh"],
    ["CI and testing", ".github/workflows/ci.yml; package.json; tests/"],
    ["Patient CORS", "src/patient/infrastructure/http/response.ts"],
    ["Private uploads", "src/lib/storage/privateUploads.ts and document stores"],
    ["Medication fallback", "src/app/api/clinical/medications/route.ts"],
]
ev = Table(evidence_rows, colWidths=[43 * mm, 122 * mm], repeatRows=1)
ev.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), NAVY),
    ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
    ("FONTNAME", (0, 0), (-1, 0), BOLD),
    ("FONTNAME", (0, 1), (-1, -1), FONT),
    ("FONTSIZE", (0, 0), (-1, -1), 8.2),
    ("LEADING", (0, 0), (-1, -1), 11),
    ("GRID", (0, 0), (-1, -1), 0.5, LINE),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, colors.HexColor("#F7FAFB")]),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
]))
story.append(ev)
story.append(Spacer(1, 18))
p("Final conclusion", "H2x")
p("The client branch demonstrates significant feature progress. It also demonstrates why accountable senior engineering remains necessary: the highest remaining risks are cross-cutting risks that individual feature completion does not resolve. The appropriate next step is a fixed, evidence-driven stabilization and production-assurance engagement.")


doc.build(story)
print(OUT)
