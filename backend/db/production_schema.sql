-- ePULSE v1.0.0 — PRODUCTION SCHEMA (structure only, no data)
--
-- The complete, empty structure of the ePULSE database: all 25 tables with their
-- columns, keys, indexes and sequences, taken from the development database on
-- 2026-10-26 (pg_dump --schema-only). It does NOT contain the PC-2 live link
-- (pc2_emp / pc2_pims schemas and the users / projects / ... views): that is
-- created afterwards by `npm run db:link-pc2` with the production PIMS server address.
--
-- Load ONCE into a NEW, EMPTY database (see deploy/PRODUCTION_INSTALL.md):
--   psql -U postgres -d "ePULSE_v1.0.0" -v ON_ERROR_STOP=1 -f backend/db/production_schema.sql
--
-- Rehearsed: restore + db:link-pc2 gives a database identical to development
-- (685 of 685 structure items), 0 rows, and the server starts and serves every page.

--
-- PostgreSQL database dump
--

\restrict 6ExV9GTUKdQzPb0GBPojHvsarEXsrPKNMp0sFFGke4DYcGZjk9I1ZjjrbgbcBFp

-- Dumped from database version 18.1
-- Dumped by pg_dump version 18.1

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
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: clash_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clash_uploads (
    id integer NOT NULL,
    job_no character varying(50) NOT NULL,
    unit_no character varying(50) NOT NULL,
    original_name character varying(300) NOT NULL,
    stored_file character varying(400) NOT NULL,
    file_size integer,
    row_count integer,
    mismatch_count integer,
    uploaded_by character varying(20),
    uploaded_at timestamp with time zone DEFAULT now()
);


--
-- Name: clash_uploads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clash_uploads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: clash_uploads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.clash_uploads_id_seq OWNED BY public.clash_uploads.id;


--
-- Name: gad_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gad_claims (
    id integer NOT NULL,
    gad_id integer NOT NULL,
    user_id character varying(20) NOT NULL,
    roles text[] NOT NULL,
    comment_type character varying(50),
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: gad_claims_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gad_claims_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gad_claims_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gad_claims_id_seq OWNED BY public.gad_claims.id;


--
-- Name: gad_comment_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gad_comment_files (
    id integer NOT NULL,
    gad_id integer NOT NULL,
    file_name character varying(500) NOT NULL,
    file_path character varying(1000),
    roles text[],
    uploaded_by text[],
    type character varying(50),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gad_comment_files_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gad_comment_files_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gad_comment_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gad_comment_files_id_seq OWNED BY public.gad_comment_files.id;


--
-- Name: gad_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gad_comments (
    id integer NOT NULL,
    gad_id integer NOT NULL,
    user_id character varying(20),
    roles text[],
    type character varying(50),
    body text,
    file_name character varying(500),
    file_path character varying(1000),
    delegated_to text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    hold_type character varying(10) DEFAULT NULL::character varying,
    hold_description text,
    cycle_no integer
);


--
-- Name: gad_comments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gad_comments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gad_comments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gad_comments_id_seq OWNED BY public.gad_comments.id;


--
-- Name: gad_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gad_history (
    id integer NOT NULL,
    gad_id integer NOT NULL,
    file_name character varying(500) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    rev_no character varying,
    uploaded_by character varying,
    action character varying DEFAULT 'upload'::character varying
);


--
-- Name: gad_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gad_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gad_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gad_history_id_seq OWNED BY public.gad_history.id;


--
-- Name: gad_lot_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gad_lot_lines (
    lot_id integer NOT NULL,
    gad_id integer NOT NULL,
    file_path text
);


--
-- Name: gad_lots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gad_lots (
    id integer NOT NULL,
    lot_number integer NOT NULL,
    job_no character varying(50) NOT NULL,
    unit_no character varying(50) NOT NULL,
    created_by character varying(50) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    issued_at timestamp with time zone
);


--
-- Name: gad_lots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gad_lots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gad_lots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gad_lots_id_seq OWNED BY public.gad_lots.id;


--
-- Name: gad_pdf_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gad_pdf_submissions (
    id integer NOT NULL,
    gad_id integer NOT NULL,
    gad_history_id integer,
    rev_no integer NOT NULL,
    cycle_no integer NOT NULL,
    pdf_file_name character varying(500),
    pdf_file_path character varying(1000),
    pdf_hash character varying(64),
    extracted_gad_no character varying(100),
    extracted_rev character varying(20),
    extracted_date character varying(50),
    extracted_sheet_count integer,
    parse_status character varying(20) DEFAULT 'PENDING'::character varying NOT NULL,
    parse_started_at timestamp with time zone,
    parse_completed_at timestamp with time zone,
    parse_error text,
    is_active boolean DEFAULT true NOT NULL,
    superseded_at timestamp with time zone,
    superseded_by integer,
    uploaded_by character varying(20),
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gad_pdf_submissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gad_pdf_submissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gad_pdf_submissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gad_pdf_submissions_id_seq OWNED BY public.gad_pdf_submissions.id;


--
-- Name: gad_pre_check_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gad_pre_check_results (
    id integer NOT NULL,
    submission_id integer NOT NULL,
    check_code character varying(50) NOT NULL,
    check_name character varying(200) NOT NULL,
    result character varying(20) NOT NULL,
    detail jsonb,
    source character varying(20) DEFAULT 'PDF_PARSED'::character varying NOT NULL,
    confidence character varying(10) DEFAULT 'MEDIUM'::character varying NOT NULL,
    checker_actioned boolean DEFAULT false NOT NULL,
    checker_action character varying(30),
    checker_comment text,
    actioned_by character varying(20),
    actioned_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: gad_pre_check_results_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gad_pre_check_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gad_pre_check_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gad_pre_check_results_id_seq OWNED BY public.gad_pre_check_results.id;


--
-- Name: gads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gads (
    id integer NOT NULL,
    job_no character varying(50) NOT NULL,
    unit_no character varying(50) NOT NULL,
    area_no character varying(10) NOT NULL,
    gad_type_seq character varying(20),
    serial_no character varying(10) NOT NULL,
    gad_no character varying(100) NOT NULL,
    file_name character varying(500),
    file_path character varying(1000),
    stored_file character varying(500),
    rev_no character varying DEFAULT 'R0-1'::character varying NOT NULL,
    status character varying(100) DEFAULT 'Uploaded'::character varying NOT NULL,
    upload_type character varying(50),
    stress_critical character(1) DEFAULT 'N'::bpchar NOT NULL,
    notify_modeller boolean DEFAULT false NOT NULL,
    notify_gl boolean DEFAULT false NOT NULL,
    all_roles_claimed boolean DEFAULT false NOT NULL,
    delegated_by_user character varying(20),
    delegated_by_role character varying(50),
    delegated_at timestamp with time zone,
    uploaded_by character varying(20),
    uploaded_on timestamp with time zone DEFAULT now() NOT NULL,
    checker_reroute jsonb DEFAULT '[]'::jsonb,
    by_user_id character varying,
    checked_user_id character varying,
    gl_user_id character varying,
    approved_by_id character varying,
    issue_cycle integer DEFAULT 0,
    upload_count integer DEFAULT 1
);


--
-- Name: gads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.gads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: gads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.gads_id_seq OWNED BY public.gads.id;


--
-- Name: inch_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inch_data (
    id integer NOT NULL,
    job_no character varying(50) NOT NULL,
    unit_no character varying(50) NOT NULL,
    uploaded_by character varying(50),
    uploaded_at timestamp with time zone DEFAULT now(),
    line_no character varying(200),
    inch_dia numeric,
    inch_meter numeric
);


--
-- Name: inch_data_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inch_data_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inch_data_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inch_data_id_seq OWNED BY public.inch_data.id;


--
-- Name: iso_clash_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.iso_clash_items (
    id integer NOT NULL,
    job_no character varying(50) NOT NULL,
    item_oid character varying(100),
    pipeline character varying(200) NOT NULL,
    item character varying(200),
    clashing_with character varying(200),
    clash_x numeric,
    clash_y numeric,
    clash_z numeric,
    remark text,
    clash_status character varying(100),
    clash_type character varying(100),
    marker_name character varying(200),
    uploaded_by character varying(20),
    uploaded_at timestamp with time zone DEFAULT now(),
    unit_no character varying(50)
);


--
-- Name: iso_clash_items_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.iso_clash_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: iso_clash_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.iso_clash_items_id_seq OWNED BY public.iso_clash_items.id;


--
-- Name: line_list; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_list (
    id bigint NOT NULL,
    line_id bigint,
    project_id character varying(255) NOT NULL,
    parent_unit character varying(255),
    unit_no character varying(255),
    service character varying(255),
    pid_no character varying(1000),
    line_no character varying(255) NOT NULL,
    line_size character varying(255),
    line_size_unit character varying(255),
    line_class character varying(255),
    line_from character varying(255),
    line_to character varying(255),
    insulation character varying(255),
    insulation_thickness character varying(255),
    design_press character varying(255),
    design_press_unit character varying(255),
    design_temp character varying(255),
    design_temp_unit character varying(255),
    oper_press character varying(255),
    oper_press_unit character varying(255),
    oper_temp character varying(255),
    oper_temp_unit character varying(255),
    has_mismatch integer DEFAULT 0 NOT NULL,
    saved_by character varying(255),
    saved_on character varying(255),
    min_design_press character varying(255),
    min_design_press_unit character varying(255),
    min_design_temp character varying(255),
    min_design_temp_unit character varying(255),
    min_operating_press character varying(255),
    min_operating_press_unit character varying(255),
    min_operating_temp character varying(255),
    min_operating_temp_unit character varying(255),
    full_vaccum character varying(255),
    fluid_state character varying(255),
    multi_phase character varying(255),
    CONSTRAINT line_list_has_mismatch_check CHECK ((has_mismatch = ANY (ARRAY[0, 1])))
);


--
-- Name: line_list_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.line_list_history (
    id bigint CONSTRAINT line_list_id_not_null NOT NULL,
    line_id bigint,
    project_id character varying(255) CONSTRAINT line_list_project_id_not_null NOT NULL,
    parent_unit character varying(255),
    unit_no character varying(255),
    service character varying(255),
    pid_no character varying(1000),
    line_no character varying(255) CONSTRAINT line_list_line_no_not_null NOT NULL,
    line_size character varying(255),
    line_size_unit character varying(255),
    line_class character varying(255),
    line_from character varying(255),
    line_to character varying(255),
    insulation character varying(255),
    insulation_thickness character varying(255),
    design_press character varying(255),
    design_press_unit character varying(255),
    design_temp character varying(255),
    design_temp_unit character varying(255),
    oper_press character varying(255),
    oper_press_unit character varying(255),
    oper_temp character varying(255),
    oper_temp_unit character varying(255),
    has_mismatch integer CONSTRAINT line_list_has_mismatch_not_null NOT NULL,
    saved_by character varying(255),
    saved_on character varying(255),
    min_design_press character varying(255),
    min_design_press_unit character varying(255),
    min_design_temp character varying(255),
    min_design_temp_unit character varying(255),
    min_operating_press character varying(255),
    min_operating_press_unit character varying(255),
    min_operating_temp character varying(255),
    min_operating_temp_unit character varying(255),
    full_vaccum character varying(255),
    fluid_state character varying(255),
    multi_phase character varying(255),
    upload_id integer,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: line_list_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.line_list_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: line_list_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.line_list_id_seq OWNED BY public.line_list.id;


--
-- Name: linelist_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.linelist_uploads (
    id integer NOT NULL,
    job_no character varying(50) NOT NULL,
    source_files text DEFAULT '[]'::text,
    rev_no integer DEFAULT 0,
    uploaded_by character varying(20),
    uploaded_at timestamp with time zone DEFAULT now(),
    row_count integer DEFAULT 0,
    is_latest boolean DEFAULT true
);


--
-- Name: linelist_uploads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.linelist_uploads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: linelist_uploads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.linelist_uploads_id_seq OWNED BY public.linelist_uploads.id;


--
-- Name: live_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_notifications (
    id integer NOT NULL,
    user_id character varying(50) NOT NULL,
    drawing_id integer,
    title text NOT NULL,
    body text NOT NULL,
    type character varying(50) DEFAULT 'task'::character varying,
    is_read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    gad_id integer
);


--
-- Name: live_notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.live_notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: live_notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.live_notifications_id_seq OWNED BY public.live_notifications.id;


--
-- Name: lms_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lms_data (
    id integer NOT NULL,
    job_no character varying(50) NOT NULL,
    unit_no character varying(50) NOT NULL,
    line_no character varying(200),
    equip_raw character varying(500),
    row_data jsonb,
    uploaded_by character varying(50),
    uploaded_at timestamp with time zone DEFAULT now(),
    lms_type character varying(255) DEFAULT 'General'::character varying NOT NULL,
    tag_no character varying(200),
    upload_id integer
);


--
-- Name: lms_data_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lms_data_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lms_data_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lms_data_id_seq OWNED BY public.lms_data.id;


--
-- Name: lms_uploads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.lms_uploads (
    id integer NOT NULL,
    job_no character varying(50) NOT NULL,
    unit_no character varying(50) NOT NULL,
    lms_type character varying(255) NOT NULL,
    file_name character varying(500) NOT NULL,
    file_data bytea NOT NULL,
    uploaded_by character varying(50),
    uploaded_at timestamp with time zone DEFAULT now()
);


--
-- Name: lms_uploads_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.lms_uploads_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: lms_uploads_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.lms_uploads_id_seq OWNED BY public.lms_uploads.id;


--
-- Name: pid_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pid_audit_log (
    id integer NOT NULL,
    action character varying(50) NOT NULL,
    master_index_id integer,
    document_id integer,
    performed_by character varying(20),
    performed_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text,
    details jsonb
);


--
-- Name: pid_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pid_audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pid_audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pid_audit_log_id_seq OWNED BY public.pid_audit_log.id;


--
-- Name: pid_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pid_documents (
    id integer NOT NULL,
    master_index_id integer NOT NULL,
    rev_label character varying(10) NOT NULL,
    rev_sort_key integer NOT NULL,
    file_name character varying(500) NOT NULL,
    file_path character varying(1000) NOT NULL,
    file_hash character varying(64) NOT NULL,
    status character varying(20) DEFAULT 'current'::character varying NOT NULL,
    superseded_by integer,
    uploaded_by character varying(20),
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_by character varying(20),
    resolved_at timestamp with time zone,
    override_reason text,
    parsed_pid_name character varying(200),
    parsed_rev_label character varying(10),
    parse_confidence character varying(20)
);


--
-- Name: pid_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pid_documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pid_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pid_documents_id_seq OWNED BY public.pid_documents.id;


--
-- Name: pid_extracted_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pid_extracted_lines (
    id integer NOT NULL,
    master_index_id integer NOT NULL,
    document_id integer NOT NULL,
    full_line_no character varying(200) NOT NULL,
    size_in character varying(20),
    service character varying(20),
    unit_no character varying(50),
    seq_no character varying(20),
    piping_spec character varying(20),
    insul_type character varying(20),
    page_no integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sub_line character varying(10)
);


--
-- Name: pid_extracted_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pid_extracted_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pid_extracted_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pid_extracted_lines_id_seq OWNED BY public.pid_extracted_lines.id;


--
-- Name: pid_index_issues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pid_index_issues (
    id integer NOT NULL,
    job_no character varying(50) NOT NULL,
    unit_no character varying(50) NOT NULL,
    source_type character varying(10) NOT NULL,
    file_name text,
    document_no character varying(100),
    document_rev character varying(20),
    unit_label character varying(100),
    date_of_issue date,
    page_count integer,
    rows_in_file integer DEFAULT 0 NOT NULL,
    added integer DEFAULT 0 NOT NULL,
    updated integer DEFAULT 0 NOT NULL,
    unchanged integer DEFAULT 0 NOT NULL,
    skipped integer DEFAULT 0 NOT NULL,
    uploaded_by character varying(20),
    uploaded_at timestamp with time zone DEFAULT now(),
    stored_path text,
    file_hash character varying(64),
    file_size integer
);


--
-- Name: pid_index_issues_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pid_index_issues_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pid_index_issues_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pid_index_issues_id_seq OWNED BY public.pid_index_issues.id;


--
-- Name: pid_master_index; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pid_master_index (
    id integer NOT NULL,
    job_no character varying(50) NOT NULL,
    unit_no character varying(50) NOT NULL,
    zone character varying(20),
    pid_name character varying(200) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_by character varying(20),
    created_at timestamp with time zone DEFAULT now(),
    retired_by character varying(20),
    retired_at timestamp with time zone,
    retire_reason text,
    description text,
    index_rev character varying(10),
    index_rev_date date,
    rev_history jsonb DEFAULT '[]'::jsonb NOT NULL,
    index_issue_id integer,
    updated_by character varying(20),
    updated_at timestamp with time zone
);


--
-- Name: pid_master_index_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pid_master_index_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pid_master_index_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pid_master_index_id_seq OWNED BY public.pid_master_index.id;


--
-- Name: piping_line_list; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.piping_line_list (
    id integer NOT NULL,
    job_no character varying(50) NOT NULL,
    unit_no character varying(50) NOT NULL,
    zone character varying(20) NOT NULL,
    line_no character varying(200) NOT NULL,
    seq_no character varying(50),
    size_in character varying(20),
    service character varying(20),
    piping_spec character varying(20),
    source character varying(20),
    created_by character varying(20),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: piping_line_list_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.piping_line_list_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: piping_line_list_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.piping_line_list_id_seq OWNED BY public.piping_line_list.id;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    sid character varying NOT NULL,
    sess jsonb NOT NULL,
    expire timestamp with time zone NOT NULL
);


--
-- Name: clash_uploads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clash_uploads ALTER COLUMN id SET DEFAULT nextval('public.clash_uploads_id_seq'::regclass);


--
-- Name: gad_claims id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_claims ALTER COLUMN id SET DEFAULT nextval('public.gad_claims_id_seq'::regclass);


--
-- Name: gad_comment_files id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_comment_files ALTER COLUMN id SET DEFAULT nextval('public.gad_comment_files_id_seq'::regclass);


--
-- Name: gad_comments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_comments ALTER COLUMN id SET DEFAULT nextval('public.gad_comments_id_seq'::regclass);


--
-- Name: gad_history id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_history ALTER COLUMN id SET DEFAULT nextval('public.gad_history_id_seq'::regclass);


--
-- Name: gad_lots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_lots ALTER COLUMN id SET DEFAULT nextval('public.gad_lots_id_seq'::regclass);


--
-- Name: gad_pdf_submissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_pdf_submissions ALTER COLUMN id SET DEFAULT nextval('public.gad_pdf_submissions_id_seq'::regclass);


--
-- Name: gad_pre_check_results id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_pre_check_results ALTER COLUMN id SET DEFAULT nextval('public.gad_pre_check_results_id_seq'::regclass);


--
-- Name: gads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gads ALTER COLUMN id SET DEFAULT nextval('public.gads_id_seq'::regclass);


--
-- Name: inch_data id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inch_data ALTER COLUMN id SET DEFAULT nextval('public.inch_data_id_seq'::regclass);


--
-- Name: iso_clash_items id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iso_clash_items ALTER COLUMN id SET DEFAULT nextval('public.iso_clash_items_id_seq'::regclass);


--
-- Name: line_list id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_list ALTER COLUMN id SET DEFAULT nextval('public.line_list_id_seq'::regclass);


--
-- Name: linelist_uploads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linelist_uploads ALTER COLUMN id SET DEFAULT nextval('public.linelist_uploads_id_seq'::regclass);


--
-- Name: live_notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_notifications ALTER COLUMN id SET DEFAULT nextval('public.live_notifications_id_seq'::regclass);


--
-- Name: lms_data id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lms_data ALTER COLUMN id SET DEFAULT nextval('public.lms_data_id_seq'::regclass);


--
-- Name: lms_uploads id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lms_uploads ALTER COLUMN id SET DEFAULT nextval('public.lms_uploads_id_seq'::regclass);


--
-- Name: pid_audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pid_audit_log ALTER COLUMN id SET DEFAULT nextval('public.pid_audit_log_id_seq'::regclass);


--
-- Name: pid_documents id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pid_documents ALTER COLUMN id SET DEFAULT nextval('public.pid_documents_id_seq'::regclass);


--
-- Name: pid_extracted_lines id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pid_extracted_lines ALTER COLUMN id SET DEFAULT nextval('public.pid_extracted_lines_id_seq'::regclass);


--
-- Name: pid_index_issues id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pid_index_issues ALTER COLUMN id SET DEFAULT nextval('public.pid_index_issues_id_seq'::regclass);


--
-- Name: pid_master_index id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pid_master_index ALTER COLUMN id SET DEFAULT nextval('public.pid_master_index_id_seq'::regclass);


--
-- Name: piping_line_list id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.piping_line_list ALTER COLUMN id SET DEFAULT nextval('public.piping_line_list_id_seq'::regclass);


--
-- Name: clash_uploads clash_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clash_uploads
    ADD CONSTRAINT clash_uploads_pkey PRIMARY KEY (id);


--
-- Name: gad_claims gad_claims_gad_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_claims
    ADD CONSTRAINT gad_claims_gad_id_user_id_key UNIQUE (gad_id, user_id);


--
-- Name: gad_claims gad_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_claims
    ADD CONSTRAINT gad_claims_pkey PRIMARY KEY (id);


--
-- Name: gad_comment_files gad_comment_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_comment_files
    ADD CONSTRAINT gad_comment_files_pkey PRIMARY KEY (id);


--
-- Name: gad_comments gad_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_comments
    ADD CONSTRAINT gad_comments_pkey PRIMARY KEY (id);


--
-- Name: gad_history gad_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_history
    ADD CONSTRAINT gad_history_pkey PRIMARY KEY (id);


--
-- Name: gad_lot_lines gad_lot_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_lot_lines
    ADD CONSTRAINT gad_lot_lines_pkey PRIMARY KEY (lot_id, gad_id);


--
-- Name: gad_lots gad_lots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_lots
    ADD CONSTRAINT gad_lots_pkey PRIMARY KEY (id);


--
-- Name: gad_pdf_submissions gad_pdf_submissions_gad_id_rev_no_cycle_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_pdf_submissions
    ADD CONSTRAINT gad_pdf_submissions_gad_id_rev_no_cycle_no_key UNIQUE (gad_id, rev_no, cycle_no);


--
-- Name: gad_pdf_submissions gad_pdf_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_pdf_submissions
    ADD CONSTRAINT gad_pdf_submissions_pkey PRIMARY KEY (id);


--
-- Name: gad_pre_check_results gad_pre_check_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_pre_check_results
    ADD CONSTRAINT gad_pre_check_results_pkey PRIMARY KEY (id);


--
-- Name: gad_pre_check_results gad_pre_check_results_submission_id_check_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_pre_check_results
    ADD CONSTRAINT gad_pre_check_results_submission_id_check_code_key UNIQUE (submission_id, check_code);


--
-- Name: gads gads_job_no_unit_no_area_no_gad_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gads
    ADD CONSTRAINT gads_job_no_unit_no_area_no_gad_no_key UNIQUE (job_no, unit_no, area_no, gad_no);


--
-- Name: gads gads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gads
    ADD CONSTRAINT gads_pkey PRIMARY KEY (id);


--
-- Name: inch_data inch_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inch_data
    ADD CONSTRAINT inch_data_pkey PRIMARY KEY (id);


--
-- Name: iso_clash_items iso_clash_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.iso_clash_items
    ADD CONSTRAINT iso_clash_items_pkey PRIMARY KEY (id);


--
-- Name: line_list line_list_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_list
    ADD CONSTRAINT line_list_pkey PRIMARY KEY (id);


--
-- Name: line_list line_list_project_id_unit_no_line_no_service_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_list
    ADD CONSTRAINT line_list_project_id_unit_no_line_no_service_key UNIQUE (project_id, unit_no, line_no, service);


--
-- Name: linelist_uploads linelist_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.linelist_uploads
    ADD CONSTRAINT linelist_uploads_pkey PRIMARY KEY (id);


--
-- Name: live_notifications live_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_notifications
    ADD CONSTRAINT live_notifications_pkey PRIMARY KEY (id);


--
-- Name: lms_data lms_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lms_data
    ADD CONSTRAINT lms_data_pkey PRIMARY KEY (id);


--
-- Name: lms_uploads lms_uploads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lms_uploads
    ADD CONSTRAINT lms_uploads_pkey PRIMARY KEY (id);


--
-- Name: pid_audit_log pid_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pid_audit_log
    ADD CONSTRAINT pid_audit_log_pkey PRIMARY KEY (id);


--
-- Name: pid_documents pid_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pid_documents
    ADD CONSTRAINT pid_documents_pkey PRIMARY KEY (id);


--
-- Name: pid_extracted_lines pid_extracted_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pid_extracted_lines
    ADD CONSTRAINT pid_extracted_lines_pkey PRIMARY KEY (id);


--
-- Name: pid_index_issues pid_index_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pid_index_issues
    ADD CONSTRAINT pid_index_issues_pkey PRIMARY KEY (id);


--
-- Name: pid_master_index pid_master_index_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pid_master_index
    ADD CONSTRAINT pid_master_index_pkey PRIMARY KEY (id);


--
-- Name: piping_line_list piping_line_list_job_no_unit_no_zone_line_no_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.piping_line_list
    ADD CONSTRAINT piping_line_list_job_no_unit_no_zone_line_no_key UNIQUE (job_no, unit_no, zone, line_no);


--
-- Name: piping_line_list piping_line_list_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.piping_line_list
    ADD CONSTRAINT piping_line_list_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (sid);


--
-- Name: idx_clash_uploads_job_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clash_uploads_job_unit ON public.clash_uploads USING btree (job_no, unit_no, uploaded_at DESC);


--
-- Name: idx_gad_checks_actioned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gad_checks_actioned ON public.gad_pre_check_results USING btree (submission_id, checker_actioned);


--
-- Name: idx_gad_checks_result; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gad_checks_result ON public.gad_pre_check_results USING btree (result);


--
-- Name: idx_gad_checks_sub; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gad_checks_sub ON public.gad_pre_check_results USING btree (submission_id);


--
-- Name: idx_gad_claims_gad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gad_claims_gad ON public.gad_claims USING btree (gad_id);


--
-- Name: idx_gad_comment_files; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gad_comment_files ON public.gad_comment_files USING btree (gad_id);


--
-- Name: idx_gad_comments_gad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gad_comments_gad ON public.gad_comments USING btree (gad_id);


--
-- Name: idx_gad_history_gad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gad_history_gad ON public.gad_history USING btree (gad_id);


--
-- Name: idx_gad_lot_lines_gad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gad_lot_lines_gad ON public.gad_lot_lines USING btree (gad_id);


--
-- Name: idx_gad_lot_lines_lot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gad_lot_lines_lot ON public.gad_lot_lines USING btree (lot_id);


--
-- Name: idx_gad_lots_job_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gad_lots_job_unit ON public.gad_lots USING btree (job_no, unit_no);


--
-- Name: idx_gad_subs_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gad_subs_active ON public.gad_pdf_submissions USING btree (gad_id, is_active);


--
-- Name: idx_gad_subs_gad; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gad_subs_gad ON public.gad_pdf_submissions USING btree (gad_id);


--
-- Name: idx_gad_subs_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gad_subs_hash ON public.gad_pdf_submissions USING btree (pdf_hash);


--
-- Name: idx_gad_subs_parse; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gad_subs_parse ON public.gad_pdf_submissions USING btree (parse_status);


--
-- Name: idx_gad_subs_rev_cycle; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gad_subs_rev_cycle ON public.gad_pdf_submissions USING btree (gad_id, rev_no, cycle_no);


--
-- Name: idx_gads_gad_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gads_gad_no ON public.gads USING btree (gad_no);


--
-- Name: idx_gads_job_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gads_job_unit ON public.gads USING btree (job_no, unit_no);


--
-- Name: idx_gads_job_unit_area; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gads_job_unit_area ON public.gads USING btree (job_no, unit_no, area_no);


--
-- Name: idx_gads_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gads_status ON public.gads USING btree (status);


--
-- Name: idx_inch_data_job_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inch_data_job_unit ON public.inch_data USING btree (job_no, unit_no);


--
-- Name: idx_inch_data_line_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inch_data_line_no ON public.inch_data USING btree (job_no, unit_no, line_no);


--
-- Name: idx_iso_clash_items_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iso_clash_items_job ON public.iso_clash_items USING btree (job_no);


--
-- Name: idx_iso_clash_items_pipeline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iso_clash_items_pipeline ON public.iso_clash_items USING btree (job_no, pipeline);


--
-- Name: idx_iso_clash_items_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_iso_clash_items_unit ON public.iso_clash_items USING btree (job_no, unit_no);


--
-- Name: idx_line_list_history_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_line_list_history_line ON public.line_list_history USING btree (project_id, service, line_no);


--
-- Name: idx_line_list_history_upload; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_line_list_history_upload ON public.line_list_history USING btree (upload_id);


--
-- Name: idx_linelist_line; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_linelist_line ON public.line_list USING btree (line_id);


--
-- Name: idx_linelist_pt; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_linelist_pt ON public.line_list USING btree (service, parent_unit, line_no);


--
-- Name: idx_ll_uploads_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ll_uploads_job ON public.linelist_uploads USING btree (job_no);


--
-- Name: idx_ll_uploads_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ll_uploads_latest ON public.linelist_uploads USING btree (job_no, is_latest);


--
-- Name: idx_lms_data_job_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lms_data_job_unit ON public.lms_data USING btree (job_no, unit_no);


--
-- Name: idx_lms_data_line_no; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lms_data_line_no ON public.lms_data USING btree (job_no, unit_no, line_no);


--
-- Name: idx_lms_data_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_lms_data_type ON public.lms_data USING btree (job_no, unit_no, lms_type);


--
-- Name: idx_ln_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ln_user ON public.live_notifications USING btree (user_id, is_read);


--
-- Name: idx_pid_audit_log_master; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pid_audit_log_master ON public.pid_audit_log USING btree (master_index_id);


--
-- Name: idx_pid_documents_current_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_pid_documents_current_unique ON public.pid_documents USING btree (master_index_id) WHERE ((status)::text = 'current'::text);


--
-- Name: idx_pid_documents_master; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pid_documents_master ON public.pid_documents USING btree (master_index_id);


--
-- Name: idx_pid_extracted_lines_document; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pid_extracted_lines_document ON public.pid_extracted_lines USING btree (document_id);


--
-- Name: idx_pid_extracted_lines_master; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pid_extracted_lines_master ON public.pid_extracted_lines USING btree (master_index_id);


--
-- Name: idx_pid_index_issues_job_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pid_index_issues_job_unit ON public.pid_index_issues USING btree (job_no, unit_no);


--
-- Name: idx_pid_master_index_active_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_pid_master_index_active_unique ON public.pid_master_index USING btree (job_no, unit_no, pid_name) WHERE ((status)::text = 'active'::text);


--
-- Name: idx_pid_master_index_job_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pid_master_index_job_unit ON public.pid_master_index USING btree (job_no, unit_no);


--
-- Name: idx_piping_line_list_job_unit; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_piping_line_list_job_unit ON public.piping_line_list USING btree (job_no, unit_no);


--
-- Name: sessions_expire_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_expire_idx ON public.sessions USING btree (expire);


--
-- Name: gad_pdf_submissions fk_gad_subs_superseded_by; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_pdf_submissions
    ADD CONSTRAINT fk_gad_subs_superseded_by FOREIGN KEY (superseded_by) REFERENCES public.gad_pdf_submissions(id) ON DELETE SET NULL;


--
-- Name: gad_claims gad_claims_gad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_claims
    ADD CONSTRAINT gad_claims_gad_id_fkey FOREIGN KEY (gad_id) REFERENCES public.gads(id) ON DELETE CASCADE;


--
-- Name: gad_comment_files gad_comment_files_gad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_comment_files
    ADD CONSTRAINT gad_comment_files_gad_id_fkey FOREIGN KEY (gad_id) REFERENCES public.gads(id) ON DELETE CASCADE;


--
-- Name: gad_comments gad_comments_gad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_comments
    ADD CONSTRAINT gad_comments_gad_id_fkey FOREIGN KEY (gad_id) REFERENCES public.gads(id) ON DELETE CASCADE;


--
-- Name: gad_history gad_history_gad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_history
    ADD CONSTRAINT gad_history_gad_id_fkey FOREIGN KEY (gad_id) REFERENCES public.gads(id) ON DELETE CASCADE;


--
-- Name: gad_lot_lines gad_lot_lines_gad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_lot_lines
    ADD CONSTRAINT gad_lot_lines_gad_id_fkey FOREIGN KEY (gad_id) REFERENCES public.gads(id);


--
-- Name: gad_lot_lines gad_lot_lines_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_lot_lines
    ADD CONSTRAINT gad_lot_lines_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.gad_lots(id) ON DELETE CASCADE;


--
-- Name: gad_pdf_submissions gad_pdf_submissions_gad_history_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_pdf_submissions
    ADD CONSTRAINT gad_pdf_submissions_gad_history_id_fkey FOREIGN KEY (gad_history_id) REFERENCES public.gad_history(id) ON DELETE SET NULL;


--
-- Name: gad_pdf_submissions gad_pdf_submissions_gad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_pdf_submissions
    ADD CONSTRAINT gad_pdf_submissions_gad_id_fkey FOREIGN KEY (gad_id) REFERENCES public.gads(id) ON DELETE CASCADE;


--
-- Name: gad_pre_check_results gad_pre_check_results_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gad_pre_check_results
    ADD CONSTRAINT gad_pre_check_results_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.gad_pdf_submissions(id) ON DELETE CASCADE;


--
-- Name: line_list_history line_list_history_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.line_list_history
    ADD CONSTRAINT line_list_history_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.linelist_uploads(id);


--
-- Name: lms_data lms_data_upload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.lms_data
    ADD CONSTRAINT lms_data_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES public.lms_uploads(id) ON DELETE SET NULL;


--
-- Name: pid_audit_log pid_audit_log_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pid_audit_log
    ADD CONSTRAINT pid_audit_log_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.pid_documents(id) ON DELETE CASCADE;


--
-- Name: pid_audit_log pid_audit_log_master_index_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pid_audit_log
    ADD CONSTRAINT pid_audit_log_master_index_id_fkey FOREIGN KEY (master_index_id) REFERENCES public.pid_master_index(id) ON DELETE CASCADE;


--
-- Name: pid_documents pid_documents_master_index_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pid_documents
    ADD CONSTRAINT pid_documents_master_index_id_fkey FOREIGN KEY (master_index_id) REFERENCES public.pid_master_index(id) ON DELETE CASCADE;


--
-- Name: pid_documents pid_documents_superseded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pid_documents
    ADD CONSTRAINT pid_documents_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.pid_documents(id);


--
-- Name: pid_extracted_lines pid_extracted_lines_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pid_extracted_lines
    ADD CONSTRAINT pid_extracted_lines_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.pid_documents(id) ON DELETE CASCADE;


--
-- Name: pid_extracted_lines pid_extracted_lines_master_index_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pid_extracted_lines
    ADD CONSTRAINT pid_extracted_lines_master_index_id_fkey FOREIGN KEY (master_index_id) REFERENCES public.pid_master_index(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict 6ExV9GTUKdQzPb0GBPojHvsarEXsrPKNMp0sFFGke4DYcGZjk9I1ZjjrbgbcBFp

