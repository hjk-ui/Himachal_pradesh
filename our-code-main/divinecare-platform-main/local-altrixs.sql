--
-- PostgreSQL database dump
--

\restrict KILjFeLkDy3DCKmUtvggLq27uAT5gHydkEKgnOxpPuVoc1rCvtv6P68UdXuxvDR

-- Dumped from database version 17.10
-- Dumped by pg_dump version 17.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: AppointmentStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."AppointmentStatus" AS ENUM (
    'SCHEDULED',
    'CHECKED_IN',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW'
);


ALTER TYPE public."AppointmentStatus" OWNER TO postgres;

--
-- Name: ClientStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ClientStatus" AS ENUM (
    'ACTIVE',
    'INACTIVE',
    'DISCHARGED'
);


ALTER TYPE public."ClientStatus" OWNER TO postgres;

--
-- Name: ConsentFormStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ConsentFormStatus" AS ENUM (
    'PENDING',
    'SIGNED',
    'EXPIRED',
    'DECLINED'
);


ALTER TYPE public."ConsentFormStatus" OWNER TO postgres;

--
-- Name: IntakeInviteStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."IntakeInviteStatus" AS ENUM (
    'PENDING',
    'COMPLETED',
    'EXPIRED'
);


ALTER TYPE public."IntakeInviteStatus" OWNER TO postgres;

--
-- Name: MessageSender; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."MessageSender" AS ENUM (
    'STAFF',
    'CLIENT'
);


ALTER TYPE public."MessageSender" OWNER TO postgres;

--
-- Name: OtpPurpose; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."OtpPurpose" AS ENUM (
    'LOGIN',
    'RESET_PASSWORD'
);


ALTER TYPE public."OtpPurpose" OWNER TO postgres;

--
-- Name: ProgressNoteWorkflowStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ProgressNoteWorkflowStatus" AS ENUM (
    'DRAFT',
    'SIGNED',
    'LOCKED'
);


ALTER TYPE public."ProgressNoteWorkflowStatus" OWNER TO postgres;

--
-- Name: RiskLevel; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."RiskLevel" AS ENUM (
    'HIGH',
    'MEDIUM',
    'LOW'
);


ALTER TYPE public."RiskLevel" OWNER TO postgres;

--
-- Name: Role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."Role" AS ENUM (
    'SUPER_ADMIN',
    'ADMIN',
    'DIRECTOR',
    'CLINICIAN',
    'FRONT_DESK',
    'BILLING',
    'HR',
    'THERAPIST',
    'PSYCHIATRIST',
    'NP',
    'PRP_SPECIALIST',
    'CASE_MANAGER',
    'PEER_SUPPORT'
);


ALTER TYPE public."Role" OWNER TO postgres;

--
-- Name: UserStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."UserStatus" AS ENUM (
    'INVITED',
    'ACTIVE',
    'DEACTIVATED'
);


ALTER TYPE public."UserStatus" OWNER TO postgres;

--
-- Name: WaitlistStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."WaitlistStatus" AS ENUM (
    'WAITING',
    'MATCHED',
    'SCHEDULED',
    'CLOSED'
);


ALTER TYPE public."WaitlistStatus" OWNER TO postgres;

--
-- Name: WaitlistUrgency; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."WaitlistUrgency" AS ENUM (
    'ROUTINE',
    'URGENT',
    'CRISIS'
);


ALTER TYPE public."WaitlistUrgency" OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: Appointment; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Appointment" (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "clinicianId" text,
    type text NOT NULL,
    "startsAt" timestamp(3) without time zone NOT NULL,
    "endsAt" timestamp(3) without time zone NOT NULL,
    status public."AppointmentStatus" DEFAULT 'SCHEDULED'::public."AppointmentStatus" NOT NULL,
    "isVirtual" boolean DEFAULT false NOT NULL,
    notes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Appointment" OWNER TO postgres;

--
-- Name: CheckIn; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."CheckIn" (
    id text NOT NULL,
    "clientId" text NOT NULL,
    mood integer NOT NULL,
    stress integer NOT NULL,
    note text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."CheckIn" OWNER TO postgres;

--
-- Name: Client; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Client" (
    id text NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    image text,
    active boolean DEFAULT true NOT NULL,
    status public."ClientStatus" DEFAULT 'ACTIVE'::public."ClientStatus" NOT NULL,
    "riskLevel" public."RiskLevel" DEFAULT 'LOW'::public."RiskLevel" NOT NULL,
    "checkInStreak" integer DEFAULT 0 NOT NULL,
    "dateOfBirth" timestamp(3) without time zone,
    gender text,
    "addressLine1" text,
    "addressLine2" text,
    city text,
    state text,
    "postalCode" text,
    "emergencyContactName" text,
    "emergencyContactPhone" text,
    "insurancePayer" text,
    "insuranceMemberId" text,
    "insuranceGroupNumber" text,
    "primaryDiagnosis" text,
    "primaryDiagnosisCode" text,
    "secondaryDiagnoses" text,
    "locationId" text,
    "assignedToId" text,
    "assignedSince" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Client" OWNER TO postgres;

--
-- Name: ClinicModuleState; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ClinicModuleState" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    module text NOT NULL,
    data jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."ClinicModuleState" OWNER TO postgres;

--
-- Name: ConsentForm; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ConsentForm" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    "clientId" text NOT NULL,
    type text NOT NULL,
    status public."ConsentFormStatus" DEFAULT 'PENDING'::public."ConsentFormStatus" NOT NULL,
    method text DEFAULT 'In-Person'::text NOT NULL,
    "sentAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "signedAt" timestamp(3) without time zone,
    "expiresAt" timestamp(3) without time zone,
    "signedByName" text,
    notes text,
    "createdById" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."ConsentForm" OWNER TO postgres;

--
-- Name: EmailOtp; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."EmailOtp" (
    id text NOT NULL,
    email text NOT NULL,
    "codeHash" text NOT NULL,
    purpose public."OtpPurpose" NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "consumedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."EmailOtp" OWNER TO postgres;

--
-- Name: IntakeInvite; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."IntakeInvite" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    token text NOT NULL,
    "clientName" text NOT NULL,
    "clientEmail" text NOT NULL,
    "clientPhone" text,
    "firstAppointment" timestamp(3) without time zone,
    status public."IntakeInviteStatus" DEFAULT 'PENDING'::public."IntakeInviteStatus" NOT NULL,
    "sentCount" integer DEFAULT 1 NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "completedAt" timestamp(3) without time zone,
    "formData" jsonb,
    "clientId" text,
    "waitlistEntryId" text,
    "assignedToId" text,
    "createdById" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."IntakeInvite" OWNER TO postgres;

--
-- Name: Location; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Location" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    code text,
    "addressLine1" text,
    "addressLine2" text,
    city text,
    state text,
    "postalCode" text,
    phone text,
    timezone text DEFAULT 'America/New_York'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "isPrimary" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Location" OWNER TO postgres;

--
-- Name: Message; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Message" (
    id text NOT NULL,
    "clientId" text NOT NULL,
    sender public."MessageSender" NOT NULL,
    content text NOT NULL,
    "readAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Message" OWNER TO postgres;

--
-- Name: Organization; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Organization" (
    id text NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Organization" OWNER TO postgres;

--
-- Name: ProgressNote; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ProgressNote" (
    id text NOT NULL,
    "clientId" text NOT NULL,
    "clinicianId" text,
    body text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."ProgressNote" OWNER TO postgres;

--
-- Name: ProgressNoteWorkflow; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ProgressNoteWorkflow" (
    "noteId" text NOT NULL,
    status public."ProgressNoteWorkflowStatus" DEFAULT 'DRAFT'::public."ProgressNoteWorkflowStatus" NOT NULL,
    "signedAt" timestamp(3) without time zone,
    "lockedAt" timestamp(3) without time zone,
    "clientId" text NOT NULL,
    "clientName" text NOT NULL,
    "clientImage" text,
    "clinicianId" text,
    "clinicianName" text,
    "clinicianImage" text,
    body text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."ProgressNoteWorkflow" OWNER TO postgres;

--
-- Name: RiskAlert; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."RiskAlert" (
    id text NOT NULL,
    "clientId" text NOT NULL,
    type text NOT NULL,
    description text,
    severity public."RiskLevel" NOT NULL,
    mood integer,
    stress integer,
    reviewed boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."RiskAlert" OWNER TO postgres;

--
-- Name: User; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."User" (
    id text NOT NULL,
    name text,
    email text NOT NULL,
    "passwordHash" text,
    role public."Role" DEFAULT 'CLINICIAN'::public."Role" NOT NULL,
    status public."UserStatus" DEFAULT 'ACTIVE'::public."UserStatus" NOT NULL,
    image text,
    "organizationId" text,
    npi text,
    "licenseNumber" text,
    "licenseExpiresAt" timestamp(3) without time zone,
    "inviteTokenHash" text,
    "inviteExpiresAt" timestamp(3) without time zone,
    "invitedById" text,
    "primaryLocationId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."User" OWNER TO postgres;

--
-- Name: UserLocation; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."UserLocation" (
    id text NOT NULL,
    "userId" text NOT NULL,
    "locationId" text NOT NULL,
    "isPrimary" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."UserLocation" OWNER TO postgres;

--
-- Name: WaitlistEntry; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."WaitlistEntry" (
    id text NOT NULL,
    "organizationId" text NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    specialty text NOT NULL,
    urgency public."WaitlistUrgency" DEFAULT 'ROUTINE'::public."WaitlistUrgency" NOT NULL,
    status public."WaitlistStatus" DEFAULT 'WAITING'::public."WaitlistStatus" NOT NULL,
    "insurancePayer" text,
    "referralSource" text,
    notes text,
    "preferredClinician" text,
    "clinicianId" text,
    "convertedClientId" text,
    "matchedAt" timestamp(3) without time zone,
    "convertedAt" timestamp(3) without time zone,
    "closedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."WaitlistEntry" OWNER TO postgres;

--
-- Data for Name: Appointment; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Appointment" (id, "clientId", "clinicianId", type, "startsAt", "endsAt", status, "isVirtual", notes, "createdAt", "updatedAt") FROM stdin;
cmssxogvc0008wclga0m8u7rs	cmssxf2py0001wcromix63o4d	\N	Medication Review	2026-08-15 12:38:00	2026-08-15 13:28:00	SCHEDULED	t	session timing	2026-08-14 12:38:57.383	2026-08-14 12:38:57.383
cmsw3s3nu000rwchgo46m9yb0	cmsw3s3ks0009wchg1qw8qjlm	\N	Crisis Follow-up	2026-08-16 03:30:00	2026-08-16 04:30:00	COMPLETED	t	\N	2026-08-16 17:53:03.115	2026-08-16 17:53:03.115
cmsw3s3nz000twchgy9xkovl0	cmsw3s3mi000fwchgudjspkol	\N	Individual Therapy	2026-08-16 04:30:00	2026-08-16 05:30:00	SCHEDULED	f	\N	2026-08-16 17:53:03.119	2026-08-16 17:53:03.119
cmsw3s3o2000vwchgf1rwlj74	cmsw3s3ms000iwchgikaougya	\N	Medication Review	2026-08-16 06:00:00	2026-08-16 06:30:00	SCHEDULED	t	\N	2026-08-16 17:53:03.122	2026-08-16 17:53:03.122
cmsw3s3o4000xwchgee8oz9ib	cmsw3s3n0000lwchgnjzjwp7c	\N	Individual Therapy	2026-08-16 08:30:00	2026-08-16 09:30:00	SCHEDULED	f	\N	2026-08-16 17:53:03.125	2026-08-16 17:53:03.125
cmsw3s3o6000zwchgeujl7ncr	cmsw3s3n6000owchg6l62kfmj	\N	Initial Assessment	2026-08-16 10:00:00	2026-08-16 11:00:00	SCHEDULED	f	\N	2026-08-16 17:53:03.126	2026-08-16 17:53:03.126
cmsw3s3o80011wchgvasyi005	cmsw3s3m8000cwchgguxtdwnt	\N	Individual Therapy	2026-08-16 11:15:00	2026-08-16 12:15:00	SCHEDULED	f	\N	2026-08-16 17:53:03.128	2026-08-16 17:53:03.128
cmsw3s3qb003fwchg0v1wwk85	cmsw3s3ks0009wchg1qw8qjlm	\N	Crisis Follow-up	2026-08-10 03:30:00	2026-08-10 04:30:00	COMPLETED	t	\N	2026-08-16 17:53:03.203	2026-08-16 17:53:03.203
cmsw3s3qd003hwchgxfjy3s6m	cmsw3s3m8000cwchgguxtdwnt	\N	Medication Check	2026-08-11 04:30:00	2026-08-11 05:00:00	SCHEDULED	f	\N	2026-08-16 17:53:03.205	2026-08-16 17:53:03.205
cmsw3s3qe003jwchgdwqtkn1y	cmsw3s3mi000fwchgudjspkol	\N	Individual Therapy	2026-08-12 05:30:00	2026-08-12 06:30:00	COMPLETED	f	\N	2026-08-16 17:53:03.207	2026-08-16 17:53:03.207
cmsw3s3qg003lwchgko8si4z3	cmsw3s3ms000iwchgikaougya	\N	Medication Review	2026-08-13 07:00:00	2026-08-13 07:30:00	SCHEDULED	t	\N	2026-08-16 17:53:03.209	2026-08-16 17:53:03.209
cmsw3s3qi003nwchgor4eareq	cmsw3s3n0000lwchgnjzjwp7c	\N	Individual Therapy	2026-08-14 08:30:00	2026-08-14 09:30:00	SCHEDULED	f	\N	2026-08-16 17:53:03.21	2026-08-16 17:53:03.21
cmsw3s3qk003pwchgcczkcyb2	cmsw3s3n6000owchg6l62kfmj	\N	Initial Assessment	2026-08-15 10:00:00	2026-08-15 11:00:00	SCHEDULED	f	\N	2026-08-16 17:53:03.212	2026-08-16 17:53:03.212
cmsx86mc8001rwcdk4djd77ka	cmsx86m7r0019wcdkbx71nqa1	cmswze9ds0009wcng97v08t3k	Crisis Follow-up	2026-08-17 03:30:00	2026-08-17 04:30:00	COMPLETED	t	\N	2026-08-17 12:44:05.144	2026-08-17 12:44:05.144
cmsx86mcd001twcdkviv9qh6z	cmsx86maa001fwcdkfradix6i	cmswze9ds0009wcng97v08t3k	Individual Therapy	2026-08-17 04:30:00	2026-08-17 05:30:00	SCHEDULED	f	\N	2026-08-17 12:44:05.15	2026-08-17 12:44:05.15
cmsx86mck001vwcdk8lxcqk18	cmsx86mak001iwcdk6ra4u2fv	cmswze9ds0009wcng97v08t3k	Medication Review	2026-08-17 06:00:00	2026-08-17 06:30:00	SCHEDULED	t	\N	2026-08-17 12:44:05.156	2026-08-17 12:44:05.156
cmsx86mcq001xwcdkjq1rv5eu	cmsx86mat001lwcdktqxh41hc	cmswze9ds0009wcng97v08t3k	Individual Therapy	2026-08-17 08:30:00	2026-08-17 09:30:00	SCHEDULED	f	\N	2026-08-17 12:44:05.162	2026-08-17 12:44:05.162
cmsx86mcw001zwcdkmu98bder	cmsx86mb3001owcdko34d8ji3	cmswze9ds0009wcng97v08t3k	Initial Assessment	2026-08-17 10:00:00	2026-08-17 11:00:00	SCHEDULED	f	\N	2026-08-17 12:44:05.168	2026-08-17 12:44:05.168
cmsx86md20021wcdkx92x2in3	cmsx86ma1001cwcdk3ouwkxc7	cmswze9ds0009wcng97v08t3k	Individual Therapy	2026-08-17 11:15:00	2026-08-17 12:15:00	SCHEDULED	f	\N	2026-08-17 12:44:05.174	2026-08-17 12:44:05.174
\.


--
-- Data for Name: CheckIn; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."CheckIn" (id, "clientId", mood, stress, note, "createdAt") FROM stdin;
cmssxm96k0006wclgah9fjkiw	cmssxf2py0001wcromix63o4d	4	8	bett then	2026-08-14 12:37:14.108
cmsw3s3kt000awchgvg198cck	cmsw3s3ks0009wchg1qw8qjlm	2	9	\N	2026-08-16 15:53:02.998
cmsw3s3m8000dwchg997ljo2i	cmsw3s3m8000cwchgguxtdwnt	4	7	\N	2026-08-15 15:53:02.998
cmsw3s3mj000gwchgpkc3jmer	cmsw3s3mi000fwchgudjspkol	7	4	\N	2026-08-16 14:53:02.998
cmsw3s3ms000jwchg44nojicb	cmsw3s3ms000iwchgikaougya	6	5	\N	2026-08-16 05:53:02.998
cmsw3s3n0000mwchg8efip1ic	cmsw3s3n0000lwchgnjzjwp7c	8	3	\N	2026-08-16 09:53:02.998
cmsw3s3n6000pwchgx2iwie50	cmsw3s3n6000owchg6l62kfmj	5	9	\N	2026-08-16 11:53:02.998
cmsw3s3oi0013wchgumkmozni	cmsw3s3ks0009wchg1qw8qjlm	2	9	\N	2026-08-10 02:45:00
cmsw3s3ok0015wchg0negwui2	cmsw3s3ks0009wchg1qw8qjlm	2	8	\N	2026-08-11 02:46:00
cmsw3s3ol0017wchg37m6xgno	cmsw3s3ks0009wchg1qw8qjlm	3	9	\N	2026-08-12 02:47:00
cmsw3s3on0019wchg2frv9lbe	cmsw3s3ks0009wchg1qw8qjlm	2	8	\N	2026-08-13 02:48:00
cmsw3s3oo001bwchga337isne	cmsw3s3ks0009wchg1qw8qjlm	4	7	\N	2026-08-14 02:49:00
cmsw3s3oq001dwchg098y6r2t	cmsw3s3ks0009wchg1qw8qjlm	3	8	\N	2026-08-15 02:50:00
cmsw3s3os001fwchg1jzx1tgn	cmsw3s3ks0009wchg1qw8qjlm	2	9	\N	2026-08-16 02:51:00
cmsw3s3ou001hwchgxrllnj2j	cmsw3s3m8000cwchgguxtdwnt	4	7	\N	2026-08-10 03:45:00
cmsw3s3ov001jwchgx7u0owsr	cmsw3s3m8000cwchgguxtdwnt	4	7	\N	2026-08-11 03:46:00
cmsw3s3ow001lwchg7upkdy31	cmsw3s3m8000cwchgguxtdwnt	5	6	\N	2026-08-12 03:47:00
cmsw3s3ox001nwchgfm4ruxwp	cmsw3s3m8000cwchgguxtdwnt	4	7	\N	2026-08-13 03:48:00
cmsw3s3oz001pwchg26juznj4	cmsw3s3m8000cwchgguxtdwnt	5	6	\N	2026-08-14 03:49:00
cmsw3s3p0001rwchgxzxi5aa6	cmsw3s3m8000cwchgguxtdwnt	4	7	\N	2026-08-15 03:50:00
cmsw3s3p2001twchg79n84nkh	cmsw3s3m8000cwchgguxtdwnt	4	7	\N	2026-08-16 03:51:00
cmsw3s3p3001vwchg692xtu65	cmsw3s3mi000fwchgudjspkol	7	4	\N	2026-08-10 04:45:00
cmsw3s3p5001xwchg712mcnmo	cmsw3s3mi000fwchgudjspkol	7	4	\N	2026-08-11 04:46:00
cmsw3s3p6001zwchgreqavryh	cmsw3s3mi000fwchgudjspkol	8	3	\N	2026-08-12 04:47:00
cmsw3s3p70021wchgyb7tw7zu	cmsw3s3mi000fwchgudjspkol	7	4	\N	2026-08-13 04:48:00
cmsw3s3p90023wchgfat60lkq	cmsw3s3mi000fwchgudjspkol	7	4	\N	2026-08-14 04:49:00
cmsw3s3pa0025wchg3lksntkv	cmsw3s3mi000fwchgudjspkol	8	3	\N	2026-08-15 04:50:00
cmsw3s3pb0027wchgfr379q1q	cmsw3s3mi000fwchgudjspkol	7	4	\N	2026-08-16 04:51:00
cmsw3s3pd0029wchgc12edqiw	cmsw3s3ms000iwchgikaougya	6	5	\N	2026-08-10 05:45:00
cmsw3s3pe002bwchg3v54470w	cmsw3s3ms000iwchgikaougya	6	5	\N	2026-08-11 05:46:00
cmsw3s3pg002dwchgsn85nyip	cmsw3s3ms000iwchgikaougya	6	5	\N	2026-08-12 05:47:00
cmsw3s3ph002fwchg5h2z6r2t	cmsw3s3ms000iwchgikaougya	7	4	\N	2026-08-13 05:48:00
cmsw3s3pi002hwchg29mu1p55	cmsw3s3ms000iwchgikaougya	6	5	\N	2026-08-14 05:49:00
cmsw3s3pk002jwchgklts55tw	cmsw3s3ms000iwchgikaougya	6	5	\N	2026-08-15 05:50:00
cmsw3s3pl002lwchgc3pqth4b	cmsw3s3ms000iwchgikaougya	6	5	\N	2026-08-16 05:51:00
cmsw3s3pn002nwchgcsigcqo5	cmsw3s3n0000lwchgnjzjwp7c	8	3	\N	2026-08-10 07:45:00
cmsw3s3po002pwchgor3sqkmw	cmsw3s3n0000lwchgnjzjwp7c	8	3	\N	2026-08-11 07:46:00
cmsw3s3pq002rwchgb7kf09se	cmsw3s3n0000lwchgnjzjwp7c	7	4	\N	2026-08-12 07:47:00
cmsw3s3pr002twchgijcikexx	cmsw3s3n0000lwchgnjzjwp7c	8	3	\N	2026-08-13 07:48:00
cmsw3s3pt002vwchgmi555b8x	cmsw3s3n0000lwchgnjzjwp7c	8	3	\N	2026-08-14 07:49:00
cmsw3s3pu002xwchgi9sehjuo	cmsw3s3n0000lwchgnjzjwp7c	8	3	\N	2026-08-15 07:50:00
cmsw3s3pw002zwchgcq34dpi3	cmsw3s3n0000lwchgnjzjwp7c	9	2	\N	2026-08-16 07:51:00
cmsw3s3px0031wchgpxn4rio4	cmsw3s3n6000owchg6l62kfmj	5	9	\N	2026-08-10 08:45:00
cmsw3s3pz0033wchgw76h3vr7	cmsw3s3n6000owchg6l62kfmj	5	8	\N	2026-08-11 08:46:00
cmsw3s3q00035wchgy3ovqrdp	cmsw3s3n6000owchg6l62kfmj	4	9	\N	2026-08-12 08:47:00
cmsw3s3q10037wchgsg69arpw	cmsw3s3n6000owchg6l62kfmj	5	8	\N	2026-08-13 08:48:00
cmsw3s3q30039wchg0j9nyyjb	cmsw3s3n6000owchg6l62kfmj	6	7	\N	2026-08-14 08:49:00
cmsw3s3q5003bwchgj5mzp0j3	cmsw3s3n6000owchg6l62kfmj	5	8	\N	2026-08-15 08:50:00
cmsw3s3q6003dwchg5noxobyr	cmsw3s3n6000owchg6l62kfmj	5	9	\N	2026-08-16 08:51:00
cmsx86m7s001awcdkv37aagsk	cmsx86m7r0019wcdkbx71nqa1	2	9	\N	2026-08-17 10:44:04.977
cmsx86ma1001dwcdkgs4n6vh3	cmsx86ma1001cwcdk3ouwkxc7	4	7	\N	2026-08-16 10:44:04.977
cmsx86maa001gwcdk9dqvuzbh	cmsx86maa001fwcdkfradix6i	7	4	\N	2026-08-17 09:44:04.977
cmsx86mak001jwcdkbv7d2jtr	cmsx86mak001iwcdk6ra4u2fv	6	5	\N	2026-08-17 00:44:04.977
cmsx86mat001mwcdkyqwts4lj	cmsx86mat001lwcdktqxh41hc	8	3	\N	2026-08-17 04:44:04.977
cmsx86mb3001pwcdknfj2hjcf	cmsx86mb3001owcdko34d8ji3	5	9	\N	2026-08-17 06:44:04.977
cmsx86mdj0023wcdkhhz5uzcy	cmsx86m7r0019wcdkbx71nqa1	2	9	\N	2026-08-11 02:45:00
cmsx86mdn0025wcdk69n2t0s6	cmsx86m7r0019wcdkbx71nqa1	2	8	\N	2026-08-12 02:46:00
cmsx86mdp0027wcdkyvrru6bp	cmsx86m7r0019wcdkbx71nqa1	3	9	\N	2026-08-13 02:47:00
cmsx86mds0029wcdk0twpok3u	cmsx86m7r0019wcdkbx71nqa1	2	8	\N	2026-08-14 02:48:00
cmsx86mdv002bwcdkhcdtowtq	cmsx86m7r0019wcdkbx71nqa1	4	7	\N	2026-08-15 02:49:00
cmsx86mdy002dwcdkkzpbhswp	cmsx86m7r0019wcdkbx71nqa1	3	8	\N	2026-08-16 02:50:00
cmsx86me1002fwcdk7ax1yphu	cmsx86m7r0019wcdkbx71nqa1	2	9	\N	2026-08-17 02:51:00
cmsx86me3002hwcdkt1p5dkwe	cmsx86ma1001cwcdk3ouwkxc7	4	7	\N	2026-08-11 03:45:00
cmsx86me5002jwcdk0wrkob76	cmsx86ma1001cwcdk3ouwkxc7	4	7	\N	2026-08-12 03:46:00
cmsx86me7002lwcdkq9wizncl	cmsx86ma1001cwcdk3ouwkxc7	5	6	\N	2026-08-13 03:47:00
cmsx86me9002nwcdkge4jn6fm	cmsx86ma1001cwcdk3ouwkxc7	4	7	\N	2026-08-14 03:48:00
cmsx86mea002pwcdkxyuolnyk	cmsx86ma1001cwcdk3ouwkxc7	5	6	\N	2026-08-15 03:49:00
cmsx86med002rwcdkha32t2p4	cmsx86ma1001cwcdk3ouwkxc7	4	7	\N	2026-08-16 03:50:00
cmsx86mef002twcdkfa2nd8ne	cmsx86ma1001cwcdk3ouwkxc7	4	7	\N	2026-08-17 03:51:00
cmsx86meg002vwcdk3tc9bax3	cmsx86maa001fwcdkfradix6i	7	4	\N	2026-08-11 04:45:00
cmsx86mei002xwcdkfzuphnt8	cmsx86maa001fwcdkfradix6i	7	4	\N	2026-08-12 04:46:00
cmsx86mek002zwcdkwb3a946m	cmsx86maa001fwcdkfradix6i	8	3	\N	2026-08-13 04:47:00
cmsx86mem0031wcdkdc7vuukk	cmsx86maa001fwcdkfradix6i	7	4	\N	2026-08-14 04:48:00
cmsx86meo0033wcdk35tf5no8	cmsx86maa001fwcdkfradix6i	7	4	\N	2026-08-15 04:49:00
cmsx86meq0035wcdkfps3ygqk	cmsx86maa001fwcdkfradix6i	8	3	\N	2026-08-16 04:50:00
cmsx86mer0037wcdkpsev5tzw	cmsx86maa001fwcdkfradix6i	7	4	\N	2026-08-17 04:51:00
cmsx86meu0039wcdkosjl9pda	cmsx86mak001iwcdk6ra4u2fv	6	5	\N	2026-08-11 05:45:00
cmsx86mez003bwcdk7ttgwylx	cmsx86mak001iwcdk6ra4u2fv	6	5	\N	2026-08-12 05:46:00
cmsx86mf1003dwcdkwp8a3uqb	cmsx86mak001iwcdk6ra4u2fv	6	5	\N	2026-08-13 05:47:00
cmsx86mf3003fwcdkhj5icuhm	cmsx86mak001iwcdk6ra4u2fv	7	4	\N	2026-08-14 05:48:00
cmsx86mf5003hwcdk97l275mx	cmsx86mak001iwcdk6ra4u2fv	6	5	\N	2026-08-15 05:49:00
cmsx86mf7003jwcdksm38bbpk	cmsx86mak001iwcdk6ra4u2fv	6	5	\N	2026-08-16 05:50:00
cmsx86mfl003lwcdkwe5t3fvj	cmsx86mak001iwcdk6ra4u2fv	6	5	\N	2026-08-17 05:51:00
cmsx86mfp003nwcdk1lik3a77	cmsx86mat001lwcdktqxh41hc	8	3	\N	2026-08-11 07:45:00
cmsx86mft003pwcdkqfemg0x6	cmsx86mat001lwcdktqxh41hc	8	3	\N	2026-08-12 07:46:00
cmsx86mfv003rwcdkgyi8zq17	cmsx86mat001lwcdktqxh41hc	7	4	\N	2026-08-13 07:47:00
cmsx86mfx003twcdkm6coda51	cmsx86mat001lwcdktqxh41hc	8	3	\N	2026-08-14 07:48:00
cmsx86mfz003vwcdkwvkg8a6v	cmsx86mat001lwcdktqxh41hc	8	3	\N	2026-08-15 07:49:00
cmsx86mg1003xwcdkrklkvu09	cmsx86mat001lwcdktqxh41hc	8	3	\N	2026-08-16 07:50:00
cmsx86mg3003zwcdkclmi00oj	cmsx86mat001lwcdktqxh41hc	9	2	\N	2026-08-17 07:51:00
cmsx86mg40041wcdkhedqhsa6	cmsx86mb3001owcdko34d8ji3	5	9	\N	2026-08-11 08:45:00
cmsx86mg80043wcdkz5dy7tss	cmsx86mb3001owcdko34d8ji3	5	8	\N	2026-08-12 08:46:00
cmsx86mga0045wcdkqu64ab94	cmsx86mb3001owcdko34d8ji3	4	9	\N	2026-08-13 08:47:00
cmsx86mgc0047wcdkyotasd4y	cmsx86mb3001owcdko34d8ji3	5	8	\N	2026-08-14 08:48:00
cmsx86mgd0049wcdkykw03qn1	cmsx86mb3001owcdko34d8ji3	6	7	\N	2026-08-15 08:49:00
cmsx86mgf004bwcdkp5dqen0w	cmsx86mb3001owcdko34d8ji3	5	8	\N	2026-08-16 08:50:00
cmsx86mgg004dwcdkzfgf4ude	cmsx86mb3001owcdko34d8ji3	5	9	\N	2026-08-17 08:51:00
\.


--
-- Data for Name: Client; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Client" (id, name, email, phone, image, active, status, "riskLevel", "checkInStreak", "dateOfBirth", gender, "addressLine1", "addressLine2", city, state, "postalCode", "emergencyContactName", "emergencyContactPhone", "insurancePayer", "insuranceMemberId", "insuranceGroupNumber", "primaryDiagnosis", "primaryDiagnosisCode", "secondaryDiagnoses", "locationId", "assignedToId", "assignedSince", "createdAt", "updatedAt") FROM stdin;
cmssxf2qa0003wcroy1rpec8y	Marcus Chen	marcus.chen@example.com	(650) 555-0177	/uploads/client-avatars/cmssxf2qa0003wcroy1rpec8y.webp?v=1786710917525	t	ACTIVE	MEDIUM	5	1987-11-02 00:00:00	Male	221 Castro St Apt 4B	\N	Mountain View	CA	94041	Linda Chen	(650) 555-0110	Aetna	AET-30918827	GRP-77201	Generalized anxiety disorder	F41.1	\N	\N	\N	2026-08-14 12:31:39.154	2026-08-14 12:31:39.154	2026-08-14 12:35:17.529
cmssxf2qd0005wcrosq9j1fw6	Sofia Alvarez	sofia.alvarez@example.com	(408) 555-0133	/uploads/client-avatars/cmssxf2qd0005wcrosq9j1fw6.webp?v=1786710893509	t	ACTIVE	HIGH	2	1995-07-28 00:00:00	Female	910 Bird Ave	\N	San Jose	CA	95125	Diego Alvarez	(408) 555-0165	Medicaid	MED-55102938	CA-MEDI-09	PTSD	F43.10	Insomnia disorder (F51.01)	\N	\N	2026-08-14 12:31:39.158	2026-08-14 12:31:39.158	2026-08-14 12:34:53.511
cmsw3s3ks0009wchg1qw8qjlm	Marcus Thompson	marcus.t@email.com	(555) 123-4567	\N	t	ACTIVE	HIGH	7	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2023-10-01 00:00:00	2026-08-16 17:53:03.004	2026-08-16 17:53:03.004
cmssxf2qh0007wcrok6pg800f	James Okafor	james.okafor@example.com	(510) 555-0188	/uploads/client-avatars/cmssxf2qh0007wcrok6pg800f.webp?v=1786710867387	t	ACTIVE	MEDIUM	8	1980-01-19 00:00:00	Male	1442 Telegraph Ave	\N	Oakland	CA	94612	Ngozi Okafor	(510) 555-0122	UnitedHealthcare	UHC-77264110	GRP-33018	Bipolar II disorder	F31.81	\N	\N	\N	2026-08-14 12:31:39.161	2026-08-14 12:31:39.161	2026-08-14 12:34:27.389
cmssxf2qk0009wcrond1z6tkp	Priya Nair	priya.nair@example.com	(925) 555-0149	/uploads/client-avatars/cmssxf2qk0009wcrond1z6tkp.webp?v=1786710849900	t	ACTIVE	LOW	21	1998-09-05 00:00:00	Female	55 Railroad Ave	\N	Danville	CA	94526	Anil Nair	(925) 555-0171	Kaiser Permanente	KP-11829475	GRP-90512	Social anxiety disorder	F40.10	\N	\N	\N	2026-08-14 12:31:39.165	2026-08-14 12:31:39.165	2026-08-14 12:34:09.903
cmssxf2qn000bwcro4p1n9nxe	Elena Vasquez	elena.vasquez@example.com	(831) 555-0155	/uploads/client-avatars/cmssxf2qn000bwcro4p1n9nxe.webp?v=1786710830024	f	INACTIVE	LOW	0	1975-04-22 00:00:00	Female	308 Ocean St	\N	Santa Cruz	CA	95060	Miguel Vasquez	(831) 555-0190	Cigna	CIG-64028193	GRP-22841	Adjustment disorder with mixed anxiety and depressed mood	F43.23	\N	\N	\N	2026-08-14 12:31:39.167	2026-08-14 12:31:39.167	2026-08-14 12:33:50.027
cmssxf2qq000dwcro0xqgddig	Noah Patel	noah.patel@example.com	(707) 555-0128	/uploads/client-avatars/cmssxf2qq000dwcro0xqgddig.webp?v=1786710813030	t	ACTIVE	LOW	15	2001-12-11 00:00:00	Male	18 Healdsburg Ave	\N	Healdsburg	CA	95448	Meera Patel	(707) 555-0160	Blue Shield of California	BSC-90218374	GRP-66103	ADHD, predominantly inattentive	F90.0	\N	\N	\N	2026-08-14 12:31:39.17	2026-08-14 12:31:39.17	2026-08-14 12:33:33.033
cmssxf2qt000fwcro4umm1cy6	Grace Kim	grace.kim@example.com	(415) 555-0166	/uploads/client-avatars/cmssxf2qt000fwcro4umm1cy6.webp?v=1786710797804	t	ACTIVE	MEDIUM	4	1989-06-30 00:00:00	Female	1200 Geary Blvd Unit 12	\N	San Francisco	CA	94109	David Kim	(415) 555-0139	Anthem	ANT-44102918	GRP-15077	Panic disorder	F41.0	Agoraphobia (F40.00)	\N	\N	2026-08-14 12:31:39.173	2026-08-14 12:31:39.173	2026-08-14 12:33:17.807
cmssxf2qv000hwcro92wxril2	Tyrone Brooks	tyrone.brooks@example.com	(510) 555-0199	/uploads/client-avatars/cmssxf2qv000hwcro92wxril2.webp?v=1786710771182	f	DISCHARGED	LOW	0	1972-08-08 00:00:00	Male	670 International Blvd	\N	Oakland	CA	94606	Sharon Brooks	(510) 555-0144	Medicare	MCR-1EG4TE5MK72	N/A	Persistent depressive disorder (dysthymia)	F34.1	\N	\N	\N	2026-08-14 12:31:39.175	2026-08-14 12:31:39.175	2026-08-14 12:32:51.184
cmssxf2qx000jwcror55p5bk5	Hannah Brooks	hannah.brooks@example.com	(925) 555-0107	/uploads/client-avatars/cmssxf2qx000jwcror55p5bk5.webp?v=1786710748680	t	ACTIVE	MEDIUM	9	1994-02-17 00:00:00	Non-binary	401 Hartz Ave	\N	Danville	CA	94526	Jordan Brooks	(925) 555-0182	Health Net	HN-88301462	GRP-44890	Obsessive-compulsive disorder	F42.2	\N	\N	\N	2026-08-14 12:31:39.178	2026-08-14 12:31:39.178	2026-08-14 12:32:28.682
cmssxf2py0001wcromix63o4d	Aisha Rahman	aisha.rahman@example.com	(415) 555-0142	/uploads/client-avatars/cmssxf2py0001wcromix63o4d.webp?v=1786710931704	t	ACTIVE	MEDIUM	1	1992-03-14 00:00:00	Female	842 Valencia St	\N	San Francisco	CA	94110	Omar Rahman	(415) 555-0198	Blue Cross Blue Shield	BCBS-88421093	GRP-44102	Major depressive disorder, single episode, moderate	F32.1	Generalized anxiety disorder (F41.1)	\N	\N	2026-08-14 12:31:39.14	2026-08-14 12:31:39.14	2026-08-14 12:37:46.235
cmsw3s3m8000cwchgguxtdwnt	Janelle Williams	janelle.w@email.com	(555) 234-5678	\N	t	ACTIVE	MEDIUM	14	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2023-09-01 00:00:00	2026-08-16 17:53:03.056	2026-08-16 17:53:03.056
cmsw3s3mi000fwchgudjspkol	Sarah Martinez	sarah.m@email.com	(555) 345-6789	\N	t	ACTIVE	LOW	21	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2023-08-01 00:00:00	2026-08-16 17:53:03.066	2026-08-16 17:53:03.066
cmsw3s3ms000iwchgikaougya	James Robinson	james.r@email.com	(555) 456-7890	\N	t	ACTIVE	LOW	5	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2023-11-01 00:00:00	2026-08-16 17:53:03.076	2026-08-16 17:53:03.076
cmsw3s3n0000lwchgnjzjwp7c	Priya Lakshmi	priya.l@email.com	(555) 567-8901	\N	t	ACTIVE	LOW	30	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2023-07-01 00:00:00	2026-08-16 17:53:03.084	2026-08-16 17:53:03.084
cmsw3s3n6000owchg6l62kfmj	David Kim	david.k@email.com	(555) 678-9012	\N	t	ACTIVE	MEDIUM	3	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	2023-12-01 00:00:00	2026-08-16 17:53:03.09	2026-08-16 17:53:03.09
cmsx86mak001iwcdk6ra4u2fv	James Robinson	james.r@role-demo.local	(555) 456-7890	\N	t	ACTIVE	LOW	5	\N	\N	\N	\N	\N	\N	\N	\N	\N	Aetna Behavioral	\N	\N	Bipolar I Disorder	F31.10	\N	cmssvv9oh0001wclg3nteqe0o	cmswze9ds0009wcng97v08t3k	2023-11-01 00:00:00	2026-08-17 12:44:05.084	2026-08-17 13:22:10.863
cmsx86mat001lwcdktqxh41hc	Priya Lakshmi	priya.l@role-demo.local	(555) 567-8901	\N	t	ACTIVE	LOW	30	\N	\N	\N	\N	\N	\N	\N	\N	\N	Medicare Part B	\N	\N	Social Anxiety Disorder	F40.10	\N	cmssvv9oh0001wclg3nteqe0o	cmswze9ds0009wcng97v08t3k	2023-07-01 00:00:00	2026-08-17 12:44:05.093	2026-08-17 13:22:10.868
cmsx86mb3001owcdko34d8ji3	David Kim	david.k@role-demo.local	(555) 678-9012	\N	t	ACTIVE	MEDIUM	3	\N	\N	\N	\N	\N	\N	\N	\N	\N	Self-pay / none	\N	\N	ADHD, Combined Presentation	F90.2	\N	cmssvv9oh0001wclg3nteqe0o	cmswze9ds0009wcng97v08t3k	2023-12-01 00:00:00	2026-08-17 12:44:05.103	2026-08-17 13:22:10.873
cmsx86m7r0019wcdkbx71nqa1	Marcus Thompson	marcus.t@role-demo.local	(555) 123-4567	\N	t	ACTIVE	HIGH	7	\N	\N	\N	\N	\N	\N	\N	\N	\N	BCBS Maryland	\N	\N	Major Depressive Disorder, Moderate	F33.1	\N	cmssvv9oh0001wclg3nteqe0o	cmswze9ds0009wcng97v08t3k	2023-10-01 00:00:00	2026-08-17 12:44:04.983	2026-08-17 13:22:10.819
cmsx86ma1001cwcdk3ouwkxc7	Janelle Williams	janelle.w@role-demo.local	(555) 234-5678	\N	t	ACTIVE	MEDIUM	14	\N	\N	\N	\N	\N	\N	\N	\N	\N	Medicaid (MD)	\N	\N	Generalized Anxiety Disorder	F41.1	\N	cmssvv9oh0001wclg3nteqe0o	cmswze9ds0009wcng97v08t3k	2023-09-01 00:00:00	2026-08-17 12:44:05.065	2026-08-17 13:22:10.851
cmsx86maa001fwcdkfradix6i	Sarah Martinez	sarah.m@role-demo.local	(555) 345-6789	\N	t	ACTIVE	LOW	21	\N	\N	\N	\N	\N	\N	\N	\N	\N	Cigna	\N	\N	PTSD, Chronic	F43.12	\N	cmssvv9oh0001wclg3nteqe0o	cmswze9ds0009wcng97v08t3k	2023-08-01 00:00:00	2026-08-17 12:44:05.074	2026-08-17 13:22:10.855
\.


--
-- Data for Name: ClinicModuleState; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ClinicModuleState" (id, "organizationId", module, data, "createdAt", "updatedAt") FROM stdin;
cmsx8adwc0003wce0m1jz6s8y	cmssvv9oe0000wclg1wka3u5t	treatment-plans	[{"id": "tp-seed-1", "goals": [{"id": "tp-seed-1-g1", "text": "Reduce depressive symptoms and improve daily functioning", "progress": 68, "objectives": ["Track mood daily", "Complete behavioral activation plan", "Report PHQ-9 decrease by 5 points"], "targetDate": "2026-08-31", "interventions": ["CBT", "Behavioral Activation", "Psychoeducation"]}], "icd10": "F33.1", "client": "Maria Santos", "status": "Active", "clinician": "Dr. Renee Jackson", "primaryDx": "Major Depressive Disorder, Moderate", "startDate": "2026-06-12", "reviewDate": "2026-09-10", "secondaryDx": "Generalized Anxiety Disorder", "clientSigned": true}, {"id": "tp-seed-2", "goals": [{"id": "tp-seed-2-g1", "text": "Reduce trauma-related intrusions and improve sleep", "progress": 42, "objectives": ["Practice grounding skills", "Complete sleep routine log", "Review safety plan weekly"], "targetDate": "2026-09-01", "interventions": ["Trauma-focused CBT", "Sleep hygiene", "Safety planning"]}], "icd10": "F43.12", "client": "James Wilson", "status": "Under Review", "clinician": "Dr. Renee Jackson", "primaryDx": "PTSD, Chronic", "startDate": "2026-05-28", "reviewDate": "2026-08-26", "secondaryDx": "Sleep disturbance", "clientSigned": false}, {"id": "tp-seed-3", "goals": [{"id": "tp-seed-3-g1", "text": "Maintain mood stability and medication consistency", "progress": 74, "objectives": ["Complete weekly mood chart", "Attend med follow-up", "Identify early warning signs"], "targetDate": "2026-10-01", "interventions": ["Medication management", "Mood tracking", "Psychoeducation"]}], "icd10": "F31.10", "client": "Aisha Johnson", "status": "Active", "clinician": "Dr. Samir Shah", "primaryDx": "Bipolar I Disorder", "startDate": "2026-04-18", "reviewDate": "2026-08-20", "secondaryDx": "Medication adherence risk", "clientSigned": true}]	2026-08-17 12:47:00.826	2026-08-17 12:47:00.826
cmsx8afe90005wce026vxjdcc	cmssvv9oe0000wclg1wka3u5t	assessments	[{"items": [{"date": "2026-08-17", "type": "PHQ-9", "flags": [], "score": 9, "severity": "Mild"}, {"date": "2026-07-20", "type": "PHQ-9", "flags": [], "score": 11, "severity": "Moderate"}, {"date": "2026-08-17", "type": "GAD-7", "flags": [], "score": 7, "severity": "Mild"}, {"date": "2026-08-17", "type": "C-SSRS", "flags": [], "score": 0, "severity": "No Ideation"}], "clientId": "cmsx86mb3001owcdko34d8ji3", "clientName": "David Kim"}, {"items": [{"date": "2026-08-17", "type": "PHQ-9", "flags": [], "score": 9, "severity": "Mild"}, {"date": "2026-07-20", "type": "PHQ-9", "flags": [], "score": 11, "severity": "Moderate"}, {"date": "2026-08-17", "type": "GAD-7", "flags": [], "score": 7, "severity": "Mild"}, {"date": "2026-08-17", "type": "C-SSRS", "flags": [], "score": 0, "severity": "No Ideation"}], "clientId": "cmsx86mat001lwcdktqxh41hc", "clientName": "Priya Lakshmi"}, {"items": [{"date": "2026-08-17", "type": "PHQ-9", "flags": [], "score": 9, "severity": "Mild"}, {"date": "2026-07-20", "type": "PHQ-9", "flags": [], "score": 11, "severity": "Moderate"}, {"date": "2026-08-17", "type": "GAD-7", "flags": [], "score": 7, "severity": "Mild"}, {"date": "2026-08-17", "type": "C-SSRS", "flags": [], "score": 0, "severity": "No Ideation"}], "clientId": "cmsx86mak001iwcdk6ra4u2fv", "clientName": "James Robinson"}, {"items": [{"date": "2026-08-17", "type": "PHQ-9", "flags": [], "score": 9, "severity": "Mild"}, {"date": "2026-07-20", "type": "PHQ-9", "flags": [], "score": 11, "severity": "Moderate"}, {"date": "2026-08-17", "type": "GAD-7", "flags": [], "score": 7, "severity": "Mild"}, {"date": "2026-08-17", "type": "C-SSRS", "flags": [], "score": 0, "severity": "No Ideation"}], "clientId": "cmsx86maa001fwcdkfradix6i", "clientName": "Sarah Martinez"}, {"items": [{"date": "2026-08-17", "type": "PHQ-9", "flags": [], "score": 9, "severity": "Mild"}, {"date": "2026-07-20", "type": "PHQ-9", "flags": [], "score": 11, "severity": "Moderate"}, {"date": "2026-08-17", "type": "GAD-7", "flags": [], "score": 7, "severity": "Mild"}, {"date": "2026-08-17", "type": "C-SSRS", "flags": [], "score": 0, "severity": "No Ideation"}], "clientId": "cmsx86ma1001cwcdk3ouwkxc7", "clientName": "Janelle Williams"}, {"items": [{"date": "2026-08-17", "type": "PHQ-9", "flags": ["Score meets clinical alert threshold - review safety plan and follow-up timing."], "score": 18, "severity": "Moderately Severe"}, {"date": "2026-07-20", "type": "PHQ-9", "flags": ["Score meets clinical alert threshold - review safety plan and follow-up timing."], "score": 20, "severity": "Severe"}, {"date": "2026-08-17", "type": "C-SSRS", "flags": [], "score": 1, "severity": "Passive Ideation"}, {"date": "2026-08-17", "type": "GAD-7", "flags": [], "score": 14, "severity": "Moderate"}, {"date": "2026-06-22", "type": "PCL-5", "flags": ["Score exceeds probable PTSD threshold - monitor symptoms and trauma response."], "score": 41, "severity": "Probable PTSD"}], "clientId": "cmsx86m7r0019wcdkbx71nqa1", "clientName": "Marcus Thompson"}]	2026-08-17 12:47:02.769	2026-08-17 12:47:02.769
cmsx8alrw0007wce07rsdb0ae	cmssvv9oe0000wclg1wka3u5t	diagnoses	[{"id": "dx-seed-1", "icd10": "F33.1", "onset": "2026-06-12", "client": "Maria Santos", "status": "Active", "dsmCode": "296.32", "severity": "Moderate", "clinician": "Dr. Renee Jackson", "primaryDx": "Major Depressive Disorder, Moderate"}, {"id": "dx-seed-2", "icd10": "F43.12", "onset": "2026-05-28", "client": "James Wilson", "status": "Active", "dsmCode": "309.81", "severity": "Severe", "clinician": "Dr. Renee Jackson", "primaryDx": "PTSD, Chronic"}, {"id": "dx-seed-3", "icd10": "F31.10", "onset": "2026-04-18", "client": "Aisha Johnson", "status": "Active", "dsmCode": "296.40", "severity": "Moderate", "clinician": "Dr. Samir Shah", "primaryDx": "Bipolar I Disorder"}, {"id": "dx-seed-4", "icd10": "F10.20", "onset": "2026-06-03", "client": "Carlos Rivera", "status": "Rule-out", "dsmCode": "303.90", "severity": "Severe", "clinician": "Dr. Ayesha Khan", "primaryDx": "Alcohol Use Disorder, Severe"}]	2026-08-17 12:47:11.032	2026-08-17 12:47:11.032
\.


--
-- Data for Name: ConsentForm; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ConsentForm" (id, "organizationId", "clientId", type, status, method, "sentAt", "signedAt", "expiresAt", "signedByName", notes, "createdById", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: EmailOtp; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."EmailOtp" (id, email, "codeHash", purpose, "expiresAt", "consumedAt", "createdAt") FROM stdin;
\.


--
-- Data for Name: IntakeInvite; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."IntakeInvite" (id, "organizationId", token, "clientName", "clientEmail", "clientPhone", "firstAppointment", status, "sentCount", "expiresAt", "completedAt", "formData", "clientId", "waitlistEntryId", "assignedToId", "createdById", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: Location; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Location" (id, "organizationId", name, code, "addressLine1", "addressLine2", city, state, "postalCode", phone, timezone, active, "isPrimary", "createdAt", "updatedAt") FROM stdin;
cmssvv9oh0001wclg3nteqe0o	cmssvv9oe0000wclg1wka3u5t	Main Clinic	MAIN	\N	\N	Baltimore	MD	\N	\N	America/New_York	t	t	2026-08-14 11:48:15.421	2026-08-14 11:48:15.421
cmssvv9oh0002wclgkl5o1efg	cmssvv9oe0000wclg1wka3u5t	Telehealth Hub	TELE	\N	\N	Remote	MD	\N	\N	America/New_York	t	f	2026-08-14 11:48:15.421	2026-08-14 11:48:15.421
cmswzn2yy0001wcbcdi18d8io	cmswzn2yx0000wcbcfogmogly	Main Clinic	MAIN	\N	\N	\N	\N	\N	\N	America/New_York	t	t	2026-08-17 08:44:56.648	2026-08-17 08:44:56.648
\.


--
-- Data for Name: Message; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Message" (id, "clientId", sender, content, "readAt", "createdAt") FROM stdin;
cmsw3s3rc003twchge717bjjv	cmsw3s3ks0009wchg1qw8qjlm	STAFF	Good morning Marcus. How are you feeling today?	2026-08-16 14:53:03.239	2026-08-16 14:53:03.239
cmsw3s3rc003uwchgv0qy9qef	cmsw3s3ks0009wchg1qw8qjlm	CLIENT	I've been having a really hard time this week. Everything feels overwhelming.	2026-08-16 15:23:03.239	2026-08-16 15:23:03.239
cmsw3s3rc003xwchgwvurqpbt	cmsw3s3m8000cwchgguxtdwnt	CLIENT	Thank you for the coping tools you recommended!	\N	2026-08-16 12:53:03.239
cmsw3s3rc003ywchg54z50ibz	cmsw3s3mi000fwchgudjspkol	CLIENT	See you at our session on Thursday.	2026-08-15 21:53:03.239	2026-08-15 21:53:03.239
cmsw3s3rc003vwchghdtff9y8	cmsw3s3ks0009wchg1qw8qjlm	CLIENT	I couldn't sleep last night and I keep thinking negative thoughts.	2026-08-16 18:10:22.285	2026-08-16 15:29:03.239
cmsw3s3rc003wwchgmeln5wlu	cmsw3s3ks0009wchg1qw8qjlm	CLIENT	I feel like no one understands what I'm going through.	2026-08-16 18:10:22.285	2026-08-16 15:35:03.239
cmsx86mhm004hwcdkad61kv0z	cmsx86m7r0019wcdkbx71nqa1	STAFF	Good morning Marcus. How are you feeling today?	2026-08-17 09:44:05.336	2026-08-17 09:44:05.336
cmsx86mhm004iwcdkeigvj1bp	cmsx86m7r0019wcdkbx71nqa1	CLIENT	I've been having a really hard time this week. Everything feels overwhelming.	2026-08-17 10:14:05.336	2026-08-17 10:14:05.336
cmsx86mhn004mwcdkmitvqxpr	cmsx86maa001fwcdkfradix6i	CLIENT	See you at our session on Thursday.	2026-08-16 16:44:05.336	2026-08-16 16:44:05.336
cmsx86mhn004jwcdkhb8luips	cmsx86m7r0019wcdkbx71nqa1	CLIENT	I couldn't sleep last night and I keep thinking negative thoughts.	2026-08-17 12:46:00.287	2026-08-17 10:20:05.336
cmsx86mhn004kwcdkfib35kb6	cmsx86m7r0019wcdkbx71nqa1	CLIENT	I feel like no one understands what I'm going through.	2026-08-17 12:46:00.287	2026-08-17 10:26:05.336
cmsx86mhn004lwcdkqarqb2r1	cmsx86ma1001cwcdk3ouwkxc7	CLIENT	Thank you for the coping tools you recommended!	2026-08-17 12:46:02.193	2026-08-17 07:44:05.336
cmsx898rh0001wce0534cc56m	cmsx86ma1001cwcdk3ouwkxc7	STAFF	HLO	2026-08-17 12:46:07.508	2026-08-17 12:46:07.51
cmsx9jm2x001qwciodyeh7vq5	cmsx86m7r0019wcdkbx71nqa1	STAFF	Good morning Marcus. How are you feeling today?	2026-08-17 10:22:10.952	2026-08-17 10:22:10.952
cmsx9jm2x001rwciowzmfefb1	cmsx86m7r0019wcdkbx71nqa1	CLIENT	I've been having a really hard time this week. Everything feels overwhelming.	2026-08-17 10:52:10.952	2026-08-17 10:52:10.952
cmsx9jm2x001vwciompx1avb0	cmsx86maa001fwcdkfradix6i	CLIENT	See you at our session on Thursday.	2026-08-16 17:22:10.952	2026-08-16 17:22:10.952
cmsx9jm2x001wwcio3fppw577	cmsx86ma1001cwcdk3ouwkxc7	STAFF	Thanks for the update, Janelle. Keep using the grounding plan and send a note if sleep worsens.	2026-08-17 07:22:10.952	2026-08-17 07:22:10.952
cmsx9jm2x001xwciopt79sy4c	cmsx86ma1001cwcdk3ouwkxc7	CLIENT	I will. The breathing practice helped a bit this morning.	2026-08-17 07:52:10.952	2026-08-17 07:52:10.952
cmsx9jm2x001zwcionlmoftkg	cmsx86mb3001owcdko34d8ji3	STAFF	Please confirm your new insurance card when you get a chance.	\N	2026-08-17 04:22:10.952
cmsx9jm2x001swciohzhrosli	cmsx86m7r0019wcdkbx71nqa1	CLIENT	I couldn't sleep last night and I keep thinking negative thoughts.	2026-08-17 13:22:58.493	2026-08-17 10:58:10.952
cmsx9jm2x001twcio6v8wlx2a	cmsx86m7r0019wcdkbx71nqa1	CLIENT	I feel like no one understands what I'm going through.	2026-08-17 13:22:58.493	2026-08-17 11:04:10.952
cmsx9jm2x001uwcionlzbz32d	cmsx86ma1001cwcdk3ouwkxc7	CLIENT	Thank you for the coping tools you recommended!	2026-08-17 13:23:13.265	2026-08-17 08:22:10.952
cmsx9jm2x001ywciobyzmioaf	cmsx86mat001lwcdktqxh41hc	CLIENT	I can do Friday after 2 PM if that works for the check-in.	2026-08-17 16:28:50.317	2026-08-17 03:22:10.952
\.


--
-- Data for Name: Organization; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Organization" (id, name, slug, active, "createdAt", "updatedAt") FROM stdin;
cmswzn2yx0000wcbcfogmogly	John Health Care	john-health-care	t	2026-08-17 08:44:56.648	2026-08-17 08:44:56.648
cmssvv9oe0000wclg1wka3u5t	Role Demo Clinic	role-demo-clinic	t	2026-08-14 11:48:15.421	2026-08-17 12:44:04.158
\.


--
-- Data for Name: ProgressNote; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ProgressNote" (id, "clientId", "clinicianId", body, "createdAt", "updatedAt") FROM stdin;
cmssxllxi0004wclg6afctbx4	cmssxf2py0001wcromix63o4d	\N	your health is good	2026-08-14 12:36:43.971	2026-08-14 12:36:43.971
role-demo-note-1	cmsx86m7r0019wcdkbx71nqa1	cmswze9ds0009wcng97v08t3k	Client reported elevated stress, disrupted sleep, and repeated negative self-talk. Reviewed coping plan, grounding steps, and safety check-in. Client agreed to use the evening routine and message the care team if symptoms worsen.	2026-08-16 11:22:10.961	2026-08-17 13:22:10.963
role-demo-note-2	cmsx86ma1001cwcdk3ouwkxc7	cmswze9ds0009wcng97v08t3k	Client processed recent family stressors and practiced a cognitive reframing exercise. Response was engaged and future-oriented. Discussed next-session goals and transportation plan.	2026-08-15 13:22:10.961	2026-08-17 13:22:11.089
role-demo-note-3	cmsx86maa001fwcdkfradix6i	cmswze9ds0009wcng97v08t3k	Initial progress note drafted after therapy session. Client shared improved sleep and stronger use of grounding skills. Note left signed for later lock after final review.	2026-08-16 13:22:10.961	2026-08-17 13:22:11.099
\.


--
-- Data for Name: ProgressNoteWorkflow; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ProgressNoteWorkflow" ("noteId", status, "signedAt", "lockedAt", "clientId", "clientName", "clientImage", "clinicianId", "clinicianName", "clinicianImage", body, "createdAt", "updatedAt") FROM stdin;
role-demo-note-1	LOCKED	2026-08-17 23:51:20.651	2026-08-17 18:52:11.072	cmsx86m7r0019wcdkbx71nqa1	Marcus Thompson	\N	cmswze9ds0009wcng97v08t3k	Therapist Nia Patel	\N	Client reported elevated stress, disrupted sleep, and repeated negative self-talk. Reviewed coping plan, grounding steps, and safety check-in. Client agreed to use the evening routine and message the care team if symptoms worsen.	2026-08-17 18:21:20.651	2026-08-17 18:52:11.072
role-demo-note-2	LOCKED	2026-08-17 23:51:20.682	2026-08-17 18:52:11.096	cmsx86ma1001cwcdk3ouwkxc7	Janelle Williams	\N	cmswze9ds0009wcng97v08t3k	Therapist Nia Patel	\N	Client processed recent family stressors and practiced a cognitive reframing exercise. Response was engaged and future-oriented. Discussed next-session goals and transportation plan.	2026-08-17 18:21:20.682	2026-08-17 18:52:11.096
role-demo-note-3	SIGNED	2026-08-17 23:51:20.69	\N	cmsx86maa001fwcdkfradix6i	Sarah Martinez	\N	cmswze9ds0009wcng97v08t3k	Therapist Nia Patel	\N	Initial progress note drafted after therapy session. Client shared improved sleep and stronger use of grounding skills. Note left signed for later lock after final review.	2026-08-17 18:21:20.69	2026-08-17 18:52:11.103
\.


--
-- Data for Name: RiskAlert; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."RiskAlert" (id, "clientId", type, description, severity, mood, stress, reviewed, "createdAt") FROM stdin;
cmsw3s3qx003qwchgmdxoyw1u	cmsw3s3ks0009wchg1qw8qjlm	Crisis keyword detected	Crisis keywords detected in journal entry	HIGH	2	9	f	2026-08-16 15:53:03.224
cmsw3s3qx003rwchgt96duhzo	cmsw3s3m8000cwchgguxtdwnt	Low mood 3+ days	Mood below 4 for 3 consecutive days	MEDIUM	4	7	f	2026-08-16 12:53:03.224
cmsw3s3qx003swchgik24zghh	cmsw3s3n6000owchg6l62kfmj	High stress (9/10)	Stress level 9/10 - highest recorded this month	MEDIUM	5	9	f	2026-08-15 17:53:03.224
cmsx86mgy004ewcdktdwgzkle	cmsx86m7r0019wcdkbx71nqa1	Crisis keyword detected	Crisis keywords detected in journal entry	HIGH	2	9	f	2026-08-17 10:44:05.312
cmsx86mgy004fwcdk4xeufg7k	cmsx86ma1001cwcdk3ouwkxc7	Low mood 3+ days	Mood below 4 for 3 consecutive days	MEDIUM	4	7	f	2026-08-17 07:44:05.312
cmsx86mgy004gwcdkkm07q7au	cmsx86mb3001owcdko34d8ji3	High stress (9/10)	Stress level 9/10 - highest recorded this month	MEDIUM	5	9	f	2026-08-16 12:44:05.312
\.


--
-- Data for Name: User; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."User" (id, name, email, "passwordHash", role, status, image, "organizationId", npi, "licenseNumber", "licenseExpiresAt", "inviteTokenHash", "inviteExpiresAt", "invitedById", "primaryLocationId", "createdAt", "updatedAt") FROM stdin;
cmsspwrbf0001wc3g65el3nah	Platform Admin	admin@altrixs.com	$2b$12$wPsrLaLIlTUaBNM22NqJYe46t3s6ItP9pKHNMQ/gHvJJSqT7kf28a	SUPER_ADMIN	ACTIVE	\N	\N	\N	\N	\N	\N	\N	\N	\N	2026-08-14 09:01:27.239	2026-08-14 12:14:07.206
cmswzn3040003wcbcjv68jvmk	Dr. John Shadow	gauravsingh42022@gmail.com	\N	ADMIN	INVITED	\N	cmswzn2yx0000wcbcfogmogly	\N	\N	\N	18483b1512d7ce26116e9174f0d9831d4b3a03d84195e31ce2826dc50e9f489c	2026-08-24 08:44:56.683	cmsspwrbf0001wc3g65el3nah	cmswzn2yy0001wcbcdi18d8io	2026-08-17 08:44:56.688	2026-08-17 08:44:56.764
cmswze9ds0009wcng97v08t3k	Therapist Nia Patel	therapist@role-demo.local	$2b$12$NhYOgq.Mh3yZvZ46BB8MAuBcFtQH9hPQhtkkJqMR7j5ieyOE8s8sm	THERAPIST	ACTIVE	\N	cmssvv9oe0000wclg1wka3u5t	\N	\N	\N	\N	\N	\N	cmssvv9oh0001wclg3nteqe0o	2026-08-17 08:38:05.056	2026-08-17 13:22:10.755
cmswze9dx000dwcng5kz7bp0u	Dr. Samir Shah	psychiatrist@role-demo.local	$2b$12$NhYOgq.Mh3yZvZ46BB8MAuBcFtQH9hPQhtkkJqMR7j5ieyOE8s8sm	PSYCHIATRIST	ACTIVE	\N	cmssvv9oe0000wclg1wka3u5t	\N	\N	\N	\N	\N	\N	cmssvv9oh0001wclg3nteqe0o	2026-08-17 08:38:05.061	2026-08-17 13:22:10.763
cmswze9e2000hwcng4jc2795u	Maya Lewis, NP	np@role-demo.local	$2b$12$NhYOgq.Mh3yZvZ46BB8MAuBcFtQH9hPQhtkkJqMR7j5ieyOE8s8sm	NP	ACTIVE	\N	cmssvv9oe0000wclg1wka3u5t	\N	\N	\N	\N	\N	\N	cmssvv9oh0001wclg3nteqe0o	2026-08-17 08:38:05.067	2026-08-17 13:22:10.766
cmswze9e7000lwcnguol09zvg	PRP Specialist Jordan Reed	prp@role-demo.local	$2b$12$NhYOgq.Mh3yZvZ46BB8MAuBcFtQH9hPQhtkkJqMR7j5ieyOE8s8sm	PRP_SPECIALIST	ACTIVE	\N	cmssvv9oe0000wclg1wka3u5t	\N	\N	\N	\N	\N	\N	cmssvv9oh0001wclg3nteqe0o	2026-08-17 08:38:05.071	2026-08-17 13:22:10.769
cmswze9ec000pwcngkoqbrle9	Case Manager Elena Brooks	case@role-demo.local	$2b$12$NhYOgq.Mh3yZvZ46BB8MAuBcFtQH9hPQhtkkJqMR7j5ieyOE8s8sm	CASE_MANAGER	ACTIVE	\N	cmssvv9oe0000wclg1wka3u5t	\N	\N	\N	\N	\N	\N	cmssvv9oh0001wclg3nteqe0o	2026-08-17 08:38:05.076	2026-08-17 13:22:10.773
cmswze9eh000twcngv5lshx9k	Peer Support Tariq Ahmed	peer@role-demo.local	$2b$12$NhYOgq.Mh3yZvZ46BB8MAuBcFtQH9hPQhtkkJqMR7j5ieyOE8s8sm	PEER_SUPPORT	ACTIVE	\N	cmssvv9oe0000wclg1wka3u5t	\N	\N	\N	\N	\N	\N	cmssvv9oh0001wclg3nteqe0o	2026-08-17 08:38:05.081	2026-08-17 13:22:10.78
cmswze9eq0011wcng3wqjgfwp	Billing Specialist Nina Clark	billing@role-demo.local	$2b$12$NhYOgq.Mh3yZvZ46BB8MAuBcFtQH9hPQhtkkJqMR7j5ieyOE8s8sm	BILLING	ACTIVE	\N	cmssvv9oe0000wclg1wka3u5t	\N	\N	\N	\N	\N	\N	cmssvv9oh0001wclg3nteqe0o	2026-08-17 08:38:05.091	2026-08-17 13:22:10.784
cmswze9ez0015wcng3a4c2apk	HR Manager Sofia Jones	hr@role-demo.local	$2b$12$NhYOgq.Mh3yZvZ46BB8MAuBcFtQH9hPQhtkkJqMR7j5ieyOE8s8sm	HR	ACTIVE	\N	cmssvv9oe0000wclg1wka3u5t	\N	\N	\N	\N	\N	\N	cmssvv9oh0001wclg3nteqe0o	2026-08-17 08:38:05.099	2026-08-17 13:22:10.788
cmswze9d10001wcngbgct5856	Clinic Admin	admin@role-demo.local	$2b$12$NhYOgq.Mh3yZvZ46BB8MAuBcFtQH9hPQhtkkJqMR7j5ieyOE8s8sm	ADMIN	ACTIVE	\N	cmssvv9oe0000wclg1wka3u5t	\N	\N	\N	\N	\N	\N	cmssvv9oh0001wclg3nteqe0o	2026-08-17 08:38:05.025	2026-08-17 13:22:10.726
cmswze9dn0005wcngvg0kamaz	Practice Director	director@role-demo.local	$2b$12$NhYOgq.Mh3yZvZ46BB8MAuBcFtQH9hPQhtkkJqMR7j5ieyOE8s8sm	DIRECTOR	ACTIVE	\N	cmssvv9oe0000wclg1wka3u5t	\N	\N	\N	\N	\N	\N	cmssvv9oh0001wclg3nteqe0o	2026-08-17 08:38:05.051	2026-08-17 13:22:10.748
cmswze9em000xwcngsuddl8pz	Office Manager	office@role-demo.local	$2b$12$NhYOgq.Mh3yZvZ46BB8MAuBcFtQH9hPQhtkkJqMR7j5ieyOE8s8sm	FRONT_DESK	ACTIVE	\N	cmssvv9oe0000wclg1wka3u5t	\N	\N	\N	\N	\N	\N	cmssvv9oh0001wclg3nteqe0o	2026-08-17 08:38:05.086	2026-08-17 13:22:10.751
\.


--
-- Data for Name: UserLocation; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."UserLocation" (id, "userId", "locationId", "isPrimary", "createdAt") FROM stdin;
cmswzfdfg0003wc0w38aptncz	cmswze9d10001wcngbgct5856	cmssvv9oh0001wclg3nteqe0o	t	2026-08-17 08:38:56.957
cmswzfdfm0007wc0w0ewxbfg5	cmswze9dn0005wcngvg0kamaz	cmssvv9oh0001wclg3nteqe0o	t	2026-08-17 08:38:56.963
cmswzfdgp000zwc0weqa0jwuw	cmswze9em000xwcngsuddl8pz	cmssvv9oh0001wclg3nteqe0o	t	2026-08-17 08:38:57.001
cmswzfdfq000bwc0wi19lmt9z	cmswze9ds0009wcng97v08t3k	cmssvv9oh0001wclg3nteqe0o	t	2026-08-17 08:38:56.967
cmswzfdfx000fwc0w96yq8k6z	cmswze9dx000dwcng5kz7bp0u	cmssvv9oh0001wclg3nteqe0o	t	2026-08-17 08:38:56.974
cmswzfdg3000jwc0wtf0ddcet	cmswze9e2000hwcng4jc2795u	cmssvv9oh0001wclg3nteqe0o	t	2026-08-17 08:38:56.98
cmswzfdga000nwc0wewv9xpql	cmswze9e7000lwcnguol09zvg	cmssvv9oh0001wclg3nteqe0o	t	2026-08-17 08:38:56.986
cmswzfdgh000rwc0whnfj23c2	cmswze9ec000pwcngkoqbrle9	cmssvv9oh0001wclg3nteqe0o	t	2026-08-17 08:38:56.993
cmswzfdgm000vwc0wvtqy97c2	cmswze9eh000twcngv5lshx9k	cmssvv9oh0001wclg3nteqe0o	t	2026-08-17 08:38:56.998
cmswzfdgs0013wc0wa0pd8iwh	cmswze9eq0011wcng3wqjgfwp	cmssvv9oh0001wclg3nteqe0o	t	2026-08-17 08:38:57.005
cmswzfdgv0017wc0wun940qkd	cmswze9ez0015wcng3a4c2apk	cmssvv9oh0001wclg3nteqe0o	t	2026-08-17 08:38:57.008
cmswzn31c0005wcbc4y9cuej0	cmswzn3040003wcbcjv68jvmk	cmswzn2yy0001wcbcdi18d8io	t	2026-08-17 08:44:56.736
\.


--
-- Data for Name: WaitlistEntry; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."WaitlistEntry" (id, "organizationId", name, email, phone, specialty, urgency, status, "insurancePayer", "referralSource", notes, "preferredClinician", "clinicianId", "convertedClientId", "matchedAt", "convertedAt", "closedAt", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Name: Appointment Appointment_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Appointment"
    ADD CONSTRAINT "Appointment_pkey" PRIMARY KEY (id);


--
-- Name: CheckIn CheckIn_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CheckIn"
    ADD CONSTRAINT "CheckIn_pkey" PRIMARY KEY (id);


--
-- Name: Client Client_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Client"
    ADD CONSTRAINT "Client_pkey" PRIMARY KEY (id);


--
-- Name: ClinicModuleState ClinicModuleState_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ClinicModuleState"
    ADD CONSTRAINT "ClinicModuleState_pkey" PRIMARY KEY (id);


--
-- Name: ConsentForm ConsentForm_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ConsentForm"
    ADD CONSTRAINT "ConsentForm_pkey" PRIMARY KEY (id);


--
-- Name: EmailOtp EmailOtp_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."EmailOtp"
    ADD CONSTRAINT "EmailOtp_pkey" PRIMARY KEY (id);


--
-- Name: IntakeInvite IntakeInvite_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."IntakeInvite"
    ADD CONSTRAINT "IntakeInvite_pkey" PRIMARY KEY (id);


--
-- Name: Location Location_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Location"
    ADD CONSTRAINT "Location_pkey" PRIMARY KEY (id);


--
-- Name: Message Message_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Message"
    ADD CONSTRAINT "Message_pkey" PRIMARY KEY (id);


--
-- Name: Organization Organization_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Organization"
    ADD CONSTRAINT "Organization_pkey" PRIMARY KEY (id);


--
-- Name: ProgressNoteWorkflow ProgressNoteWorkflow_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProgressNoteWorkflow"
    ADD CONSTRAINT "ProgressNoteWorkflow_pkey" PRIMARY KEY ("noteId");


--
-- Name: ProgressNote ProgressNote_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProgressNote"
    ADD CONSTRAINT "ProgressNote_pkey" PRIMARY KEY (id);


--
-- Name: RiskAlert RiskAlert_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."RiskAlert"
    ADD CONSTRAINT "RiskAlert_pkey" PRIMARY KEY (id);


--
-- Name: UserLocation UserLocation_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."UserLocation"
    ADD CONSTRAINT "UserLocation_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: WaitlistEntry WaitlistEntry_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."WaitlistEntry"
    ADD CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY (id);


--
-- Name: Appointment_clientId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Appointment_clientId_idx" ON public."Appointment" USING btree ("clientId");


--
-- Name: Appointment_clinicianId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Appointment_clinicianId_idx" ON public."Appointment" USING btree ("clinicianId");


--
-- Name: Appointment_startsAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Appointment_startsAt_idx" ON public."Appointment" USING btree ("startsAt");


--
-- Name: Appointment_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Appointment_status_idx" ON public."Appointment" USING btree (status);


--
-- Name: CheckIn_clientId_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "CheckIn_clientId_createdAt_idx" ON public."CheckIn" USING btree ("clientId", "createdAt");


--
-- Name: Client_active_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Client_active_idx" ON public."Client" USING btree (active);


--
-- Name: Client_assignedToId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Client_assignedToId_idx" ON public."Client" USING btree ("assignedToId");


--
-- Name: Client_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Client_email_key" ON public."Client" USING btree (email);


--
-- Name: Client_locationId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Client_locationId_idx" ON public."Client" USING btree ("locationId");


--
-- Name: Client_riskLevel_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Client_riskLevel_idx" ON public."Client" USING btree ("riskLevel");


--
-- Name: Client_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Client_status_idx" ON public."Client" USING btree (status);


--
-- Name: ClinicModuleState_organizationId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ClinicModuleState_organizationId_idx" ON public."ClinicModuleState" USING btree ("organizationId");


--
-- Name: ClinicModuleState_organizationId_module_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "ClinicModuleState_organizationId_module_key" ON public."ClinicModuleState" USING btree ("organizationId", module);


--
-- Name: ConsentForm_clientId_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ConsentForm_clientId_status_idx" ON public."ConsentForm" USING btree ("clientId", status);


--
-- Name: ConsentForm_expiresAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ConsentForm_expiresAt_idx" ON public."ConsentForm" USING btree ("expiresAt");


--
-- Name: ConsentForm_organizationId_status_sentAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ConsentForm_organizationId_status_sentAt_idx" ON public."ConsentForm" USING btree ("organizationId", status, "sentAt");


--
-- Name: EmailOtp_email_purpose_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "EmailOtp_email_purpose_idx" ON public."EmailOtp" USING btree (email, purpose);


--
-- Name: IntakeInvite_clientEmail_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IntakeInvite_clientEmail_idx" ON public."IntakeInvite" USING btree ("clientEmail");


--
-- Name: IntakeInvite_expiresAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IntakeInvite_expiresAt_idx" ON public."IntakeInvite" USING btree ("expiresAt");


--
-- Name: IntakeInvite_organizationId_status_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IntakeInvite_organizationId_status_createdAt_idx" ON public."IntakeInvite" USING btree ("organizationId", status, "createdAt");


--
-- Name: IntakeInvite_token_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "IntakeInvite_token_key" ON public."IntakeInvite" USING btree (token);


--
-- Name: IntakeInvite_waitlistEntryId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "IntakeInvite_waitlistEntryId_idx" ON public."IntakeInvite" USING btree ("waitlistEntryId");


--
-- Name: Location_organizationId_active_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Location_organizationId_active_idx" ON public."Location" USING btree ("organizationId", active);


--
-- Name: Location_organizationId_name_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Location_organizationId_name_key" ON public."Location" USING btree ("organizationId", name);


--
-- Name: Message_clientId_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Message_clientId_createdAt_idx" ON public."Message" USING btree ("clientId", "createdAt");


--
-- Name: Message_readAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Message_readAt_idx" ON public."Message" USING btree ("readAt");


--
-- Name: Organization_slug_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Organization_slug_key" ON public."Organization" USING btree (slug);


--
-- Name: ProgressNoteWorkflow_clientId_lockedAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ProgressNoteWorkflow_clientId_lockedAt_idx" ON public."ProgressNoteWorkflow" USING btree ("clientId", "lockedAt");


--
-- Name: ProgressNoteWorkflow_clinicianId_lockedAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ProgressNoteWorkflow_clinicianId_lockedAt_idx" ON public."ProgressNoteWorkflow" USING btree ("clinicianId", "lockedAt");


--
-- Name: ProgressNoteWorkflow_status_lockedAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ProgressNoteWorkflow_status_lockedAt_idx" ON public."ProgressNoteWorkflow" USING btree (status, "lockedAt");


--
-- Name: ProgressNote_clientId_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ProgressNote_clientId_createdAt_idx" ON public."ProgressNote" USING btree ("clientId", "createdAt");


--
-- Name: ProgressNote_clinicianId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ProgressNote_clinicianId_idx" ON public."ProgressNote" USING btree ("clinicianId");


--
-- Name: RiskAlert_clientId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "RiskAlert_clientId_idx" ON public."RiskAlert" USING btree ("clientId");


--
-- Name: RiskAlert_reviewed_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "RiskAlert_reviewed_createdAt_idx" ON public."RiskAlert" USING btree (reviewed, "createdAt");


--
-- Name: UserLocation_locationId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "UserLocation_locationId_idx" ON public."UserLocation" USING btree ("locationId");


--
-- Name: UserLocation_userId_locationId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "UserLocation_userId_locationId_key" ON public."UserLocation" USING btree ("userId", "locationId");


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: User_inviteTokenHash_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "User_inviteTokenHash_idx" ON public."User" USING btree ("inviteTokenHash");


--
-- Name: User_organizationId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "User_organizationId_idx" ON public."User" USING btree ("organizationId");


--
-- Name: User_primaryLocationId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "User_primaryLocationId_idx" ON public."User" USING btree ("primaryLocationId");


--
-- Name: User_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "User_status_idx" ON public."User" USING btree (status);


--
-- Name: WaitlistEntry_clinicianId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "WaitlistEntry_clinicianId_idx" ON public."WaitlistEntry" USING btree ("clinicianId");


--
-- Name: WaitlistEntry_organizationId_status_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "WaitlistEntry_organizationId_status_createdAt_idx" ON public."WaitlistEntry" USING btree ("organizationId", status, "createdAt");


--
-- Name: WaitlistEntry_urgency_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "WaitlistEntry_urgency_idx" ON public."WaitlistEntry" USING btree (urgency);


--
-- Name: Appointment Appointment_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Appointment"
    ADD CONSTRAINT "Appointment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Appointment Appointment_clinicianId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Appointment"
    ADD CONSTRAINT "Appointment_clinicianId_fkey" FOREIGN KEY ("clinicianId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: CheckIn CheckIn_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CheckIn"
    ADD CONSTRAINT "CheckIn_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Client Client_assignedToId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Client"
    ADD CONSTRAINT "Client_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Client Client_locationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Client"
    ADD CONSTRAINT "Client_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES public."Location"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ClinicModuleState ClinicModuleState_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ClinicModuleState"
    ADD CONSTRAINT "ClinicModuleState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ConsentForm ConsentForm_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ConsentForm"
    ADD CONSTRAINT "ConsentForm_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ConsentForm ConsentForm_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ConsentForm"
    ADD CONSTRAINT "ConsentForm_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: IntakeInvite IntakeInvite_assignedToId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."IntakeInvite"
    ADD CONSTRAINT "IntakeInvite_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: IntakeInvite IntakeInvite_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."IntakeInvite"
    ADD CONSTRAINT "IntakeInvite_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: IntakeInvite IntakeInvite_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."IntakeInvite"
    ADD CONSTRAINT "IntakeInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: IntakeInvite IntakeInvite_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."IntakeInvite"
    ADD CONSTRAINT "IntakeInvite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: IntakeInvite IntakeInvite_waitlistEntryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."IntakeInvite"
    ADD CONSTRAINT "IntakeInvite_waitlistEntryId_fkey" FOREIGN KEY ("waitlistEntryId") REFERENCES public."WaitlistEntry"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Location Location_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Location"
    ADD CONSTRAINT "Location_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Message Message_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Message"
    ADD CONSTRAINT "Message_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProgressNoteWorkflow ProgressNoteWorkflow_noteId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProgressNoteWorkflow"
    ADD CONSTRAINT "ProgressNoteWorkflow_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES public."ProgressNote"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProgressNote ProgressNote_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProgressNote"
    ADD CONSTRAINT "ProgressNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ProgressNote ProgressNote_clinicianId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ProgressNote"
    ADD CONSTRAINT "ProgressNote_clinicianId_fkey" FOREIGN KEY ("clinicianId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: RiskAlert RiskAlert_clientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."RiskAlert"
    ADD CONSTRAINT "RiskAlert_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES public."Client"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: UserLocation UserLocation_locationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."UserLocation"
    ADD CONSTRAINT "UserLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES public."Location"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: UserLocation UserLocation_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."UserLocation"
    ADD CONSTRAINT "UserLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: User User_invitedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: User User_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: User User_primaryLocationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_primaryLocationId_fkey" FOREIGN KEY ("primaryLocationId") REFERENCES public."Location"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: WaitlistEntry WaitlistEntry_clinicianId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."WaitlistEntry"
    ADD CONSTRAINT "WaitlistEntry_clinicianId_fkey" FOREIGN KEY ("clinicianId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: WaitlistEntry WaitlistEntry_convertedClientId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."WaitlistEntry"
    ADD CONSTRAINT "WaitlistEntry_convertedClientId_fkey" FOREIGN KEY ("convertedClientId") REFERENCES public."Client"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: WaitlistEntry WaitlistEntry_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."WaitlistEntry"
    ADD CONSTRAINT "WaitlistEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public."Organization"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict KILjFeLkDy3DCKmUtvggLq27uAT5gHydkEKgnOxpPuVoc1rCvtv6P68UdXuxvDR

