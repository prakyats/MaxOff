export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string;
          actor_id: string | null;
          at: string;
          diff: Json;
          entity: string;
          entity_id: string;
          id: number;
          meta: Json;
          on_behalf_of_id: string | null;
          org_id: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          at?: string;
          diff?: Json;
          entity: string;
          entity_id: string;
          id?: never;
          meta?: Json;
          on_behalf_of_id?: string | null;
          org_id: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          at?: string;
          diff?: Json;
          entity?: string;
          entity_id?: string;
          id?: never;
          meta?: Json;
          on_behalf_of_id?: string | null;
          org_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "activity_log_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_log_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_log_on_behalf_of_id_fkey";
            columns: ["on_behalf_of_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_log_on_behalf_of_id_fkey";
            columns: ["on_behalf_of_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_log_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      attendance_days: {
        Row: {
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          decision_reason: string | null;
          end_not_recorded: boolean;
          ended_at: string | null;
          final_status: Database["public"]["Enums"]["day_status"] | null;
          id: string;
          is_day_off: boolean;
          leave_request_id: string | null;
          member_id: string;
          overtime_flag: boolean;
          overtime_reason: string | null;
          proposed_by_system: boolean;
          started_at: string | null;
          state: Database["public"]["Enums"]["attendance_state"];
          submitted_at: string | null;
          submitted_choice: Database["public"]["Enums"]["attendance_choice"] | null;
          updated_at: string;
          work_date: string;
          worked_on_leave: boolean;
        };
        Insert: {
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_reason?: string | null;
          end_not_recorded?: boolean;
          ended_at?: string | null;
          final_status?: Database["public"]["Enums"]["day_status"] | null;
          id?: string;
          is_day_off?: boolean;
          leave_request_id?: string | null;
          member_id: string;
          overtime_flag?: boolean;
          overtime_reason?: string | null;
          proposed_by_system?: boolean;
          started_at?: string | null;
          state?: Database["public"]["Enums"]["attendance_state"];
          submitted_at?: string | null;
          submitted_choice?: Database["public"]["Enums"]["attendance_choice"] | null;
          updated_at?: string;
          work_date: string;
          worked_on_leave?: boolean;
        };
        Update: {
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_reason?: string | null;
          end_not_recorded?: boolean;
          ended_at?: string | null;
          final_status?: Database["public"]["Enums"]["day_status"] | null;
          id?: string;
          is_day_off?: boolean;
          leave_request_id?: string | null;
          member_id?: string;
          overtime_flag?: boolean;
          overtime_reason?: string | null;
          proposed_by_system?: boolean;
          started_at?: string | null;
          state?: Database["public"]["Enums"]["attendance_state"];
          submitted_at?: string | null;
          submitted_choice?: Database["public"]["Enums"]["attendance_choice"] | null;
          updated_at?: string;
          work_date?: string;
          worked_on_leave?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "attendance_days_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_days_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_days_leave_request_id_fkey";
            columns: ["leave_request_id"];
            isOneToOne: false;
            referencedRelation: "leave_requests";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_days_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_days_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      attendance_events: {
        Row: {
          action: string;
          actor_id: string | null;
          at: string;
          attendance_day_id: string;
          from_status: Database["public"]["Enums"]["day_status"] | null;
          id: number;
          reason: string | null;
          to_status: Database["public"]["Enums"]["day_status"] | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          at?: string;
          attendance_day_id: string;
          from_status?: Database["public"]["Enums"]["day_status"] | null;
          id?: never;
          reason?: string | null;
          to_status?: Database["public"]["Enums"]["day_status"] | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          at?: string;
          attendance_day_id?: string;
          from_status?: Database["public"]["Enums"]["day_status"] | null;
          id?: never;
          reason?: string | null;
          to_status?: Database["public"]["Enums"]["day_status"] | null;
        };
        Relationships: [
          {
            foreignKeyName: "attendance_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_events_attendance_day_id_fkey";
            columns: ["attendance_day_id"];
            isOneToOne: false;
            referencedRelation: "attendance_days";
            referencedColumns: ["id"];
          },
        ];
      };
      client_admin_assignments: {
        Row: {
          admin_id: string;
          assigned_by: string | null;
          client_id: string;
          created_at: string;
          from_at: string;
          id: string;
          to_at: string | null;
        };
        Insert: {
          admin_id: string;
          assigned_by?: string | null;
          client_id: string;
          created_at?: string;
          from_at?: string;
          id?: string;
          to_at?: string | null;
        };
        Update: {
          admin_id?: string;
          assigned_by?: string | null;
          client_id?: string;
          created_at?: string;
          from_at?: string;
          id?: string;
          to_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "client_admin_assignments_admin_id_fkey";
            columns: ["admin_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_admin_assignments_admin_id_fkey";
            columns: ["admin_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_admin_assignments_assigned_by_fkey";
            columns: ["assigned_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_admin_assignments_assigned_by_fkey";
            columns: ["assigned_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_admin_assignments_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "client_labels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_admin_assignments_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      client_brand: {
        Row: {
          brand_notes: string | null;
          client_id: string;
          colors: Json;
          created_at: string;
          fonts: Json;
          logo_file_id: string | null;
          tone_of_voice: string | null;
          updated_at: string;
        };
        Insert: {
          brand_notes?: string | null;
          client_id: string;
          colors?: Json;
          created_at?: string;
          fonts?: Json;
          logo_file_id?: string | null;
          tone_of_voice?: string | null;
          updated_at?: string;
        };
        Update: {
          brand_notes?: string | null;
          client_id?: string;
          colors?: Json;
          created_at?: string;
          fonts?: Json;
          logo_file_id?: string | null;
          tone_of_voice?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_brand_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: true;
            referencedRelation: "client_labels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_brand_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: true;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_brand_logo_file_id_fkey";
            columns: ["logo_file_id"];
            isOneToOne: false;
            referencedRelation: "files";
            referencedColumns: ["id"];
          },
        ];
      };
      client_close_reasons: {
        Row: {
          activity_id: number;
          client_id: string;
          created_at: string;
          org_id: string;
          reason: string;
        };
        Insert: {
          activity_id: number;
          client_id: string;
          created_at?: string;
          org_id: string;
          reason: string;
        };
        Update: {
          activity_id?: number;
          client_id?: string;
          created_at?: string;
          org_id?: string;
          reason?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_close_reasons_activity_id_fkey";
            columns: ["activity_id"];
            isOneToOne: true;
            referencedRelation: "activity_log";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_close_reasons_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "client_labels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_close_reasons_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_close_reasons_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      client_contacts: {
        Row: {
          archived_at: string | null;
          client_id: string;
          created_at: string;
          custom_fields: Json;
          designation: string | null;
          email: string | null;
          id: string;
          is_primary: boolean;
          name: string;
          org_id: string;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          client_id: string;
          created_at?: string;
          custom_fields?: Json;
          designation?: string | null;
          email?: string | null;
          id?: string;
          is_primary?: boolean;
          name: string;
          org_id?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          client_id?: string;
          created_at?: string;
          custom_fields?: Json;
          designation?: string | null;
          email?: string | null;
          id?: string;
          is_primary?: boolean;
          name?: string;
          org_id?: string;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_contacts_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "client_labels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_contacts_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_contacts_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      client_private: {
        Row: {
          client_id: string;
          created_at: string;
          owner_notes: string | null;
          updated_at: string;
        };
        Insert: {
          client_id: string;
          created_at?: string;
          owner_notes?: string | null;
          updated_at?: string;
        };
        Update: {
          client_id?: string;
          created_at?: string;
          owner_notes?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_private_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: true;
            referencedRelation: "client_labels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "client_private_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: true;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      clients: {
        Row: {
          activated_at: string | null;
          address: string | null;
          admin_id: string | null;
          archived_at: string | null;
          city: string | null;
          created_at: string;
          created_by: string | null;
          custom_fields: Json;
          drive_url: string | null;
          email: string | null;
          gstin: string | null;
          id: string;
          legal_name: string | null;
          name: string;
          notes: string | null;
          org_id: string;
          phone: string | null;
          requirements: string | null;
          search: unknown;
          state: Database["public"]["Enums"]["client_state"];
          updated_at: string;
          website: string | null;
        };
        Insert: {
          activated_at?: string | null;
          address?: string | null;
          admin_id?: string | null;
          archived_at?: string | null;
          city?: string | null;
          created_at?: string;
          created_by?: string | null;
          custom_fields?: Json;
          drive_url?: string | null;
          email?: string | null;
          gstin?: string | null;
          id?: string;
          legal_name?: string | null;
          name: string;
          notes?: string | null;
          org_id?: string;
          phone?: string | null;
          requirements?: string | null;
          search?: unknown;
          state?: Database["public"]["Enums"]["client_state"];
          updated_at?: string;
          website?: string | null;
        };
        Update: {
          activated_at?: string | null;
          address?: string | null;
          admin_id?: string | null;
          archived_at?: string | null;
          city?: string | null;
          created_at?: string;
          created_by?: string | null;
          custom_fields?: Json;
          drive_url?: string | null;
          email?: string | null;
          gstin?: string | null;
          id?: string;
          legal_name?: string | null;
          name?: string;
          notes?: string | null;
          org_id?: string;
          phone?: string | null;
          requirements?: string | null;
          search?: unknown;
          state?: Database["public"]["Enums"]["client_state"];
          updated_at?: string;
          website?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "clients_admin_id_fkey";
            columns: ["admin_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "clients_admin_id_fkey";
            columns: ["admin_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "clients_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "clients_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "clients_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      comp_leave_credit_uses: {
        Row: {
          created_at: string;
          credit_id: string;
          days: number;
          id: string;
          leave_request_id: string;
          state: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          credit_id: string;
          days: number;
          id?: string;
          leave_request_id: string;
          state?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          credit_id?: string;
          days?: number;
          id?: string;
          leave_request_id?: string;
          state?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "comp_leave_credit_uses_credit_id_fkey";
            columns: ["credit_id"];
            isOneToOne: false;
            referencedRelation: "comp_leave_credits";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comp_leave_credit_uses_leave_request_id_fkey";
            columns: ["leave_request_id"];
            isOneToOne: false;
            referencedRelation: "leave_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      comp_leave_credits: {
        Row: {
          created_at: string;
          days: number;
          expires_on: string;
          granted_at: string;
          granted_by: string;
          granted_on: string;
          id: string;
          member_id: string;
          note: string | null;
          note_id: string | null;
          request_key: string | null;
          reserved_days: number;
          revoke_reason: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          updated_at: string;
          used_days: number;
        };
        Insert: {
          created_at?: string;
          days: number;
          expires_on: string;
          granted_at?: string;
          granted_by: string;
          granted_on: string;
          id?: string;
          member_id: string;
          note?: string | null;
          note_id?: string | null;
          request_key?: string | null;
          reserved_days?: number;
          revoke_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          updated_at?: string;
          used_days?: number;
        };
        Update: {
          created_at?: string;
          days?: number;
          expires_on?: string;
          granted_at?: string;
          granted_by?: string;
          granted_on?: string;
          id?: string;
          member_id?: string;
          note?: string | null;
          note_id?: string | null;
          request_key?: string | null;
          reserved_days?: number;
          revoke_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          updated_at?: string;
          used_days?: number;
        };
        Relationships: [
          {
            foreignKeyName: "comp_leave_credits_granted_by_fkey";
            columns: ["granted_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comp_leave_credits_granted_by_fkey";
            columns: ["granted_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comp_leave_credits_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comp_leave_credits_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comp_leave_credits_note_id_fkey";
            columns: ["note_id"];
            isOneToOne: false;
            referencedRelation: "extra_work_notes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comp_leave_credits_revoked_by_fkey";
            columns: ["revoked_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comp_leave_credits_revoked_by_fkey";
            columns: ["revoked_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      expense_claims: {
        Row: {
          amount: number;
          category_id: string;
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          decision_reason: string | null;
          expense_date: string;
          id: string;
          member_id: string;
          note: string;
          paid_at: string | null;
          paid_by: string | null;
          paid_on: string | null;
          receipt_file_id: string | null;
          state: string;
          updated_at: string;
        };
        Insert: {
          amount: number;
          category_id: string;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_reason?: string | null;
          expense_date: string;
          id?: string;
          member_id: string;
          note: string;
          paid_at?: string | null;
          paid_by?: string | null;
          paid_on?: string | null;
          receipt_file_id?: string | null;
          state?: string;
          updated_at?: string;
        };
        Update: {
          amount?: number;
          category_id?: string;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_reason?: string | null;
          expense_date?: string;
          id?: string;
          member_id?: string;
          note?: string;
          paid_at?: string | null;
          paid_by?: string | null;
          paid_on?: string | null;
          receipt_file_id?: string | null;
          state?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "expense_claims_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "list_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_claims_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_claims_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_claims_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_claims_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_claims_paid_by_fkey";
            columns: ["paid_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_claims_paid_by_fkey";
            columns: ["paid_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "expense_claims_receipt_file_id_fkey";
            columns: ["receipt_file_id"];
            isOneToOne: true;
            referencedRelation: "files";
            referencedColumns: ["id"];
          },
        ];
      };
      extra_work_notes: {
        Row: {
          created_at: string;
          day_marked_worked: boolean;
          decided_at: string | null;
          decided_by: string | null;
          decision: string | null;
          duration_minutes: number | null;
          id: string;
          kind: string;
          member_id: string;
          note: string;
          state: string;
          updated_at: string;
          work_date: string;
        };
        Insert: {
          created_at?: string;
          day_marked_worked?: boolean;
          decided_at?: string | null;
          decided_by?: string | null;
          decision?: string | null;
          duration_minutes?: number | null;
          id?: string;
          kind: string;
          member_id: string;
          note: string;
          state?: string;
          updated_at?: string;
          work_date: string;
        };
        Update: {
          created_at?: string;
          day_marked_worked?: boolean;
          decided_at?: string | null;
          decided_by?: string | null;
          decision?: string | null;
          duration_minutes?: number | null;
          id?: string;
          kind?: string;
          member_id?: string;
          note?: string;
          state?: string;
          updated_at?: string;
          work_date?: string;
        };
        Relationships: [
          {
            foreignKeyName: "extra_work_notes_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "extra_work_notes_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "extra_work_notes_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "extra_work_notes_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      field_definitions: {
        Row: {
          archived_at: string | null;
          client_id: string | null;
          created_at: string;
          entity: string;
          help_text: string | null;
          id: string;
          key: string;
          label: string;
          options: Json;
          org_id: string;
          position: string;
          required: boolean;
          section: string | null;
          task_type_id: string | null;
          type: Database["public"]["Enums"]["field_type"];
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          client_id?: string | null;
          created_at?: string;
          entity: string;
          help_text?: string | null;
          id?: string;
          key: string;
          label: string;
          options?: Json;
          org_id?: string;
          position: string;
          required?: boolean;
          section?: string | null;
          task_type_id?: string | null;
          type: Database["public"]["Enums"]["field_type"];
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          client_id?: string | null;
          created_at?: string;
          entity?: string;
          help_text?: string | null;
          id?: string;
          key?: string;
          label?: string;
          options?: Json;
          org_id?: string;
          position?: string;
          required?: boolean;
          section?: string | null;
          task_type_id?: string | null;
          type?: Database["public"]["Enums"]["field_type"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "field_definitions_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "client_labels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "field_definitions_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "field_definitions_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "field_definitions_task_type_id_fkey";
            columns: ["task_type_id"];
            isOneToOne: false;
            referencedRelation: "task_types";
            referencedColumns: ["id"];
          },
        ];
      };
      files: {
        Row: {
          archived_at: string | null;
          created_at: string;
          id: string;
          mime: string;
          name: string;
          org_id: string;
          preview_of: string | null;
          sha256: string | null;
          size_bytes: number;
          status: string;
          storage_key: string;
          updated_at: string;
          uploaded_by: string | null;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          mime: string;
          name: string;
          org_id?: string;
          preview_of?: string | null;
          sha256?: string | null;
          size_bytes: number;
          status?: string;
          storage_key: string;
          updated_at?: string;
          uploaded_by?: string | null;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          id?: string;
          mime?: string;
          name?: string;
          org_id?: string;
          preview_of?: string | null;
          sha256?: string | null;
          size_bytes?: number;
          status?: string;
          storage_key?: string;
          updated_at?: string;
          uploaded_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "files_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "files_preview_of_fkey";
            columns: ["preview_of"];
            isOneToOne: false;
            referencedRelation: "files";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "files_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "files_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      holidays: {
        Row: {
          created_at: string;
          date: string;
          id: string;
          name: string;
          org_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          date: string;
          id?: string;
          name: string;
          org_id?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          date?: string;
          id?: string;
          name?: string;
          org_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "holidays_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      leave_requests: {
        Row: {
          created_at: string;
          credit_days: number | null;
          decided_at: string | null;
          decided_by: string | null;
          decision_reason: string | null;
          end_date: string;
          id: string;
          member_id: string;
          reason: string | null;
          requests_cancellation: boolean;
          source: string;
          start_date: string;
          state: Database["public"]["Enums"]["leave_state"];
          supersedes_id: string | null;
          type: Database["public"]["Enums"]["leave_type"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          credit_days?: number | null;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_reason?: string | null;
          end_date: string;
          id?: string;
          member_id: string;
          reason?: string | null;
          requests_cancellation?: boolean;
          source: string;
          start_date: string;
          state?: Database["public"]["Enums"]["leave_state"];
          supersedes_id?: string | null;
          type: Database["public"]["Enums"]["leave_type"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          credit_days?: number | null;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_reason?: string | null;
          end_date?: string;
          id?: string;
          member_id?: string;
          reason?: string | null;
          requests_cancellation?: boolean;
          source?: string;
          start_date?: string;
          state?: Database["public"]["Enums"]["leave_state"];
          supersedes_id?: string | null;
          type?: Database["public"]["Enums"]["leave_type"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "leave_requests_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leave_requests_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leave_requests_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leave_requests_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "leave_requests_supersedes_id_fkey";
            columns: ["supersedes_id"];
            isOneToOne: false;
            referencedRelation: "leave_requests";
            referencedColumns: ["id"];
          },
        ];
      };
      list_items: {
        Row: {
          archived_at: string | null;
          color: string | null;
          created_at: string;
          description: string | null;
          icon: string | null;
          id: string;
          is_system: boolean;
          list_key: string;
          meta: Json;
          name: string;
          org_id: string;
          position: string;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          color?: string | null;
          created_at?: string;
          description?: string | null;
          icon?: string | null;
          id?: string;
          is_system?: boolean;
          list_key: string;
          meta?: Json;
          name: string;
          org_id?: string;
          position?: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          color?: string | null;
          created_at?: string;
          description?: string | null;
          icon?: string | null;
          id?: string;
          is_system?: boolean;
          list_key?: string;
          meta?: Json;
          name?: string;
          org_id?: string;
          position?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "list_items_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      member_app_reports: {
        Row: {
          is_standalone: boolean;
          member_id: string;
          org_id: string;
          platform: string;
          reported_at: string;
        };
        Insert: {
          is_standalone: boolean;
          member_id: string;
          org_id: string;
          platform: string;
          reported_at?: string;
        };
        Update: {
          is_standalone?: boolean;
          member_id?: string;
          org_id?: string;
          platform?: string;
          reported_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "member_app_reports_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: true;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_app_reports_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: true;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_app_reports_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      member_coordinators: {
        Row: {
          coordinator_id: string;
          created_at: string;
          from_at: string;
          id: string;
          member_id: string;
          reason: string | null;
          set_by: string | null;
          to_at: string | null;
        };
        Insert: {
          coordinator_id: string;
          created_at?: string;
          from_at?: string;
          id?: string;
          member_id: string;
          reason?: string | null;
          set_by?: string | null;
          to_at?: string | null;
        };
        Update: {
          coordinator_id?: string;
          created_at?: string;
          from_at?: string;
          id?: string;
          member_id?: string;
          reason?: string | null;
          set_by?: string | null;
          to_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "member_coordinators_coordinator_id_fkey";
            columns: ["coordinator_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_coordinators_coordinator_id_fkey";
            columns: ["coordinator_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_coordinators_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_coordinators_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_coordinators_set_by_fkey";
            columns: ["set_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_coordinators_set_by_fkey";
            columns: ["set_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      member_onboarding: {
        Row: {
          finished_at: string | null;
          finished_via: string | null;
          member_id: string;
          org_id: string;
          started_at: string;
        };
        Insert: {
          finished_at?: string | null;
          finished_via?: string | null;
          member_id: string;
          org_id: string;
          started_at?: string;
        };
        Update: {
          finished_at?: string | null;
          finished_via?: string | null;
          member_id?: string;
          org_id?: string;
          started_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "member_onboarding_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: true;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_onboarding_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: true;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_onboarding_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      member_reachability: {
        Row: {
          alerted_at: string | null;
          created_at: string;
          member_id: string;
          org_id: string;
          since: string;
          state: string;
          updated_at: string;
        };
        Insert: {
          alerted_at?: string | null;
          created_at?: string;
          member_id: string;
          org_id: string;
          since: string;
          state: string;
          updated_at?: string;
        };
        Update: {
          alerted_at?: string | null;
          created_at?: string;
          member_id?: string;
          org_id?: string;
          since?: string;
          state?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "member_reachability_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: true;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_reachability_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: true;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_reachability_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      members: {
        Row: {
          avatar_file_id: string | null;
          created_at: string;
          deactivated_at: string | null;
          email: string | null;
          engagement: Database["public"]["Enums"]["engagement"];
          full_name: string;
          id: string;
          invited_at: string;
          job_title_id: string | null;
          joined_at: string | null;
          org_id: string;
          phone: string | null;
          role: Database["public"]["Enums"]["member_role"];
          status: Database["public"]["Enums"]["member_status"];
          updated_at: string;
        };
        Insert: {
          avatar_file_id?: string | null;
          created_at?: string;
          deactivated_at?: string | null;
          email?: string | null;
          engagement?: Database["public"]["Enums"]["engagement"];
          full_name: string;
          id: string;
          invited_at?: string;
          job_title_id?: string | null;
          joined_at?: string | null;
          org_id?: string;
          phone?: string | null;
          role: Database["public"]["Enums"]["member_role"];
          status?: Database["public"]["Enums"]["member_status"];
          updated_at?: string;
        };
        Update: {
          avatar_file_id?: string | null;
          created_at?: string;
          deactivated_at?: string | null;
          email?: string | null;
          engagement?: Database["public"]["Enums"]["engagement"];
          full_name?: string;
          id?: string;
          invited_at?: string;
          job_title_id?: string | null;
          joined_at?: string | null;
          org_id?: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["member_role"];
          status?: Database["public"]["Enums"]["member_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "members_avatar_file_id_fkey";
            columns: ["avatar_file_id"];
            isOneToOne: false;
            referencedRelation: "files";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "members_job_title_id_fkey";
            columns: ["job_title_id"];
            isOneToOne: false;
            referencedRelation: "list_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "members_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_deliveries: {
        Row: {
          attempts: number;
          batch_id: string | null;
          channel: string;
          created_at: string;
          id: string;
          last_error: string | null;
          next_attempt_at: string;
          notification_id: string;
          sent_at: string | null;
          state: string;
        };
        Insert: {
          attempts?: number;
          batch_id?: string | null;
          channel: string;
          created_at?: string;
          id?: string;
          last_error?: string | null;
          next_attempt_at?: string;
          notification_id: string;
          sent_at?: string | null;
          state?: string;
        };
        Update: {
          attempts?: number;
          batch_id?: string | null;
          channel?: string;
          created_at?: string;
          id?: string;
          last_error?: string | null;
          next_attempt_at?: string;
          notification_id?: string;
          sent_at?: string | null;
          state?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_notification_id_fkey";
            columns: ["notification_id"];
            isOneToOne: false;
            referencedRelation: "notifications";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_kinds: {
        Row: {
          actionable: boolean;
          always_email: boolean;
          description: string;
          in_app: boolean;
          kind: string;
        };
        Insert: {
          actionable?: boolean;
          always_email?: boolean;
          description: string;
          in_app?: boolean;
          kind: string;
        };
        Update: {
          actionable?: boolean;
          always_email?: boolean;
          description?: string;
          in_app?: boolean;
          kind?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          actor_id: string | null;
          body: string | null;
          created_at: string;
          entity: string | null;
          entity_id: string | null;
          escalation_level: number;
          id: string;
          kind: string;
          link: string | null;
          org_id: string;
          payload: Json;
          read_at: string | null;
          recipient_id: string;
          title: string;
        };
        Insert: {
          actor_id?: string | null;
          body?: string | null;
          created_at?: string;
          entity?: string | null;
          entity_id?: string | null;
          escalation_level?: number;
          id?: string;
          kind: string;
          link?: string | null;
          org_id: string;
          payload?: Json;
          read_at?: string | null;
          recipient_id: string;
          title: string;
        };
        Update: {
          actor_id?: string | null;
          body?: string | null;
          created_at?: string;
          entity?: string | null;
          entity_id?: string | null;
          escalation_level?: number;
          id?: string;
          kind?: string;
          link?: string | null;
          org_id?: string;
          payload?: Json;
          read_at?: string | null;
          recipient_id?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_kind_fkey";
            columns: ["kind"];
            isOneToOne: false;
            referencedRelation: "notification_kinds";
            referencedColumns: ["kind"];
          },
          {
            foreignKeyName: "notifications_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      org_settings: {
        Row: {
          ack_escalate_hours: number;
          ack_escalate_owner_hours: number;
          ack_repeat_hours: number;
          created_at: string;
          default_task_reminders: Json;
          email_daily_cap_org: number;
          email_daily_cap_per_member: number;
          end_day_cutoff_time: string;
          expense_receipt_above: number;
          logout_reminder_time: string;
          org_id: string;
          overdue_escalate_hours: number;
          quiet_hours_end: string;
          quiet_hours_start: string;
          reachability_clock_from: string | null;
          updated_at: string;
          weekly_off_days: number[];
          workload_warning_threshold: number | null;
        };
        Insert: {
          ack_escalate_hours?: number;
          ack_escalate_owner_hours?: number;
          ack_repeat_hours?: number;
          created_at?: string;
          default_task_reminders?: Json;
          email_daily_cap_org?: number;
          email_daily_cap_per_member?: number;
          end_day_cutoff_time?: string;
          expense_receipt_above?: number;
          logout_reminder_time?: string;
          org_id: string;
          overdue_escalate_hours?: number;
          quiet_hours_end?: string;
          quiet_hours_start?: string;
          reachability_clock_from?: string | null;
          updated_at?: string;
          weekly_off_days?: number[];
          workload_warning_threshold?: number | null;
        };
        Update: {
          ack_escalate_hours?: number;
          ack_escalate_owner_hours?: number;
          ack_repeat_hours?: number;
          created_at?: string;
          default_task_reminders?: Json;
          email_daily_cap_org?: number;
          email_daily_cap_per_member?: number;
          end_day_cutoff_time?: string;
          expense_receipt_above?: number;
          logout_reminder_time?: string;
          org_id?: string;
          overdue_escalate_hours?: number;
          quiet_hours_end?: string;
          quiet_hours_start?: string;
          reachability_clock_from?: string | null;
          updated_at?: string;
          weekly_off_days?: number[];
          workload_warning_threshold?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "org_settings_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          created_at: string;
          id: string;
          logo_file_id: string | null;
          name: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          logo_file_id?: string | null;
          name: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          logo_file_id?: string | null;
          name?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organizations_logo_file_id_fkey";
            columns: ["logo_file_id"];
            isOneToOne: false;
            referencedRelation: "files";
            referencedColumns: ["id"];
          },
        ];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          disabled_at: string | null;
          disabled_reason: string | null;
          endpoint: string;
          failure_count: number;
          id: string;
          is_standalone: boolean;
          label: string | null;
          last_failure_at: string | null;
          last_seen_at: string;
          last_success_at: string | null;
          last_test_at: string | null;
          member_id: string;
          p256dh: string;
          platform: string;
          user_agent: string | null;
        };
        Insert: {
          auth: string;
          created_at?: string;
          disabled_at?: string | null;
          disabled_reason?: string | null;
          endpoint: string;
          failure_count?: number;
          id?: string;
          is_standalone?: boolean;
          label?: string | null;
          last_failure_at?: string | null;
          last_seen_at?: string;
          last_success_at?: string | null;
          last_test_at?: string | null;
          member_id?: string;
          p256dh: string;
          platform?: string;
          user_agent?: string | null;
        };
        Update: {
          auth?: string;
          created_at?: string;
          disabled_at?: string | null;
          disabled_reason?: string | null;
          endpoint?: string;
          failure_count?: number;
          id?: string;
          is_standalone?: boolean;
          label?: string | null;
          last_failure_at?: string | null;
          last_seen_at?: string;
          last_success_at?: string | null;
          last_test_at?: string | null;
          member_id?: string;
          p256dh?: string;
          platform?: string;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "push_subscriptions_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      role_permissions: {
        Row: {
          permission: string;
          role: Database["public"]["Enums"]["member_role"];
        };
        Insert: {
          permission: string;
          role: Database["public"]["Enums"]["member_role"];
        };
        Update: {
          permission?: string;
          role?: Database["public"]["Enums"]["member_role"];
        };
        Relationships: [];
      };
      session_events: {
        Row: {
          at: string;
          id: string;
          ip_hash: string | null;
          kind: string;
          member_id: string;
          user_agent: string | null;
        };
        Insert: {
          at?: string;
          id?: string;
          ip_hash?: string | null;
          kind: string;
          member_id: string;
          user_agent?: string | null;
        };
        Update: {
          at?: string;
          id?: string;
          ip_hash?: string | null;
          kind?: string;
          member_id?: string;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "session_events_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "session_events_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      task_assignees: {
        Row: {
          acknowledged_at: string | null;
          acknowledged_by: string | null;
          assigned_at: string;
          assigned_by: string | null;
          is_primary: boolean;
          member_id: string;
          removed_at: string | null;
          task_id: string;
        };
        Insert: {
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          assigned_at?: string;
          assigned_by?: string | null;
          is_primary?: boolean;
          member_id: string;
          removed_at?: string | null;
          task_id: string;
        };
        Update: {
          acknowledged_at?: string | null;
          acknowledged_by?: string | null;
          assigned_at?: string;
          assigned_by?: string | null;
          is_primary?: boolean;
          member_id?: string;
          removed_at?: string | null;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_assignees_acknowledged_by_fkey";
            columns: ["acknowledged_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_assignees_acknowledged_by_fkey";
            columns: ["acknowledged_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_assignees_assigned_by_fkey";
            columns: ["assigned_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_assignees_assigned_by_fkey";
            columns: ["assigned_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_assignees_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_assignees_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_assignees_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      task_comments: {
        Row: {
          author_id: string;
          body: string;
          created_at: string;
          id: string;
          on_behalf_of: string | null;
          task_id: string;
        };
        Insert: {
          author_id?: string;
          body: string;
          created_at?: string;
          id?: string;
          on_behalf_of?: string | null;
          task_id: string;
        };
        Update: {
          author_id?: string;
          body?: string;
          created_at?: string;
          id?: string;
          on_behalf_of?: string | null;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_comments_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_comments_on_behalf_of_fkey";
            columns: ["on_behalf_of"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_comments_on_behalf_of_fkey";
            columns: ["on_behalf_of"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_comments_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      task_reads: {
        Row: {
          last_read_at: string;
          member_id: string;
          task_id: string;
        };
        Insert: {
          last_read_at?: string;
          member_id: string;
          task_id: string;
        };
        Update: {
          last_read_at?: string;
          member_id?: string;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_reads_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_reads_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_reads_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      task_reminder_arms: {
        Row: {
          armed_at: string;
          task_id: string;
        };
        Insert: {
          armed_at?: string;
          task_id: string;
        };
        Update: {
          armed_at?: string;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_reminder_arms_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: true;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      task_reminders: {
        Row: {
          cancelled_at: string | null;
          created_at: string;
          deadline: string | null;
          escalation_level: number | null;
          fire_at: string;
          held: boolean;
          id: string;
          kind: string;
          last_before_due: boolean;
          member_id: string | null;
          offset_minutes: number | null;
          org_id: string;
          sent_at: string | null;
          task_id: string;
        };
        Insert: {
          cancelled_at?: string | null;
          created_at?: string;
          deadline?: string | null;
          escalation_level?: number | null;
          fire_at: string;
          held?: boolean;
          id?: string;
          kind: string;
          last_before_due?: boolean;
          member_id?: string | null;
          offset_minutes?: number | null;
          org_id: string;
          sent_at?: string | null;
          task_id: string;
        };
        Update: {
          cancelled_at?: string | null;
          created_at?: string;
          deadline?: string | null;
          escalation_level?: number | null;
          fire_at?: string;
          held?: boolean;
          id?: string;
          kind?: string;
          last_before_due?: boolean;
          member_id?: string | null;
          offset_minutes?: number | null;
          org_id?: string;
          sent_at?: string | null;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_reminders_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_reminders_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_reminders_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_reminders_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      task_requests: {
        Row: {
          client_id: string | null;
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          decision_reason: string | null;
          details: string | null;
          id: string;
          org_id: string;
          requested_by: string;
          state: Database["public"]["Enums"]["request_state"];
          task_id: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          client_id?: string | null;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_reason?: string | null;
          details?: string | null;
          id?: string;
          org_id?: string;
          requested_by: string;
          state?: Database["public"]["Enums"]["request_state"];
          task_id?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          client_id?: string | null;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          decision_reason?: string | null;
          details?: string | null;
          id?: string;
          org_id?: string;
          requested_by?: string;
          state?: Database["public"]["Enums"]["request_state"];
          task_id?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_requests_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "client_labels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_requests_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_requests_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_requests_decided_by_fkey";
            columns: ["decided_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_requests_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_requests_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_requests_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_requests_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      task_reviews: {
        Row: {
          at: string;
          decision: Database["public"]["Enums"]["review_decision"];
          id: string;
          reason: string | null;
          reviewer_id: string;
          step: string;
          submission_id: string | null;
          task_id: string;
        };
        Insert: {
          at?: string;
          decision: Database["public"]["Enums"]["review_decision"];
          id?: string;
          reason?: string | null;
          reviewer_id: string;
          step: string;
          submission_id?: string | null;
          task_id: string;
        };
        Update: {
          at?: string;
          decision?: Database["public"]["Enums"]["review_decision"];
          id?: string;
          reason?: string | null;
          reviewer_id?: string;
          step?: string;
          submission_id?: string | null;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_reviews_reviewer_id_fkey";
            columns: ["reviewer_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_reviews_reviewer_id_fkey";
            columns: ["reviewer_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_reviews_submission_id_fkey";
            columns: ["submission_id"];
            isOneToOne: false;
            referencedRelation: "task_submissions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_reviews_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      task_stages: {
        Row: {
          created_at: string;
          done_at: string | null;
          done_by: string | null;
          id: string;
          name: string;
          on_behalf_of: string | null;
          position: string;
          task_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          done_at?: string | null;
          done_by?: string | null;
          id?: string;
          name: string;
          on_behalf_of?: string | null;
          position?: string;
          task_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          done_at?: string | null;
          done_by?: string | null;
          id?: string;
          name?: string;
          on_behalf_of?: string | null;
          position?: string;
          task_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_stages_done_by_fkey";
            columns: ["done_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_stages_done_by_fkey";
            columns: ["done_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_stages_on_behalf_of_fkey";
            columns: ["on_behalf_of"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_stages_on_behalf_of_fkey";
            columns: ["on_behalf_of"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_stages_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      task_submissions: {
        Row: {
          at: string;
          id: string;
          note: string | null;
          on_behalf_of: string | null;
          submitted_by: string;
          task_id: string;
          version: number;
        };
        Insert: {
          at?: string;
          id?: string;
          note?: string | null;
          on_behalf_of?: string | null;
          submitted_by: string;
          task_id: string;
          version: number;
        };
        Update: {
          at?: string;
          id?: string;
          note?: string | null;
          on_behalf_of?: string | null;
          submitted_by?: string;
          task_id?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "task_submissions_on_behalf_of_fkey";
            columns: ["on_behalf_of"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_submissions_on_behalf_of_fkey";
            columns: ["on_behalf_of"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_submissions_submitted_by_fkey";
            columns: ["submitted_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_submissions_submitted_by_fkey";
            columns: ["submitted_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_submissions_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      task_templates: {
        Row: {
          archived_at: string | null;
          created_at: string;
          created_by: string;
          default_priority: Database["public"]["Enums"]["priority"];
          description: string | null;
          field_defaults: Json;
          id: string;
          name: string;
          org_id: string;
          reminder_rules: Json;
          stages: string[];
          task_type_id: string;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          created_at?: string;
          created_by?: string;
          default_priority?: Database["public"]["Enums"]["priority"];
          description?: string | null;
          field_defaults?: Json;
          id?: string;
          name: string;
          org_id?: string;
          reminder_rules?: Json;
          stages?: string[];
          task_type_id: string;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          created_at?: string;
          created_by?: string;
          default_priority?: Database["public"]["Enums"]["priority"];
          description?: string | null;
          field_defaults?: Json;
          id?: string;
          name?: string;
          org_id?: string;
          reminder_rules?: Json;
          stages?: string[];
          task_type_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_templates_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_templates_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_templates_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_templates_task_type_id_fkey";
            columns: ["task_type_id"];
            isOneToOne: false;
            referencedRelation: "task_types";
            referencedColumns: ["id"];
          },
        ];
      };
      task_types: {
        Row: {
          archived_at: string | null;
          color: string | null;
          created_at: string;
          default_reminders: Json;
          has_location: boolean;
          icon: string | null;
          id: string;
          is_system: boolean;
          kind: Database["public"]["Enums"]["task_type_kind"];
          name: string;
          org_id: string;
          position: string;
          shows_on_calendar: boolean;
          updated_at: string;
        };
        Insert: {
          archived_at?: string | null;
          color?: string | null;
          created_at?: string;
          default_reminders?: Json;
          has_location?: boolean;
          icon?: string | null;
          id?: string;
          is_system?: boolean;
          kind?: Database["public"]["Enums"]["task_type_kind"];
          name: string;
          org_id?: string;
          position?: string;
          shows_on_calendar?: boolean;
          updated_at?: string;
        };
        Update: {
          archived_at?: string | null;
          color?: string | null;
          created_at?: string;
          default_reminders?: Json;
          has_location?: boolean;
          icon?: string | null;
          id?: string;
          is_system?: boolean;
          kind?: Database["public"]["Enums"]["task_type_kind"];
          name?: string;
          org_id?: string;
          position?: string;
          shows_on_calendar?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_types_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      task_warnings: {
        Row: {
          at: string;
          details: Json;
          id: string;
          kind: string;
          member_id: string;
          overridden_by: string;
          task_id: string;
        };
        Insert: {
          at?: string;
          details?: Json;
          id?: string;
          kind: string;
          member_id: string;
          overridden_by: string;
          task_id: string;
        };
        Update: {
          at?: string;
          details?: Json;
          id?: string;
          kind?: string;
          member_id?: string;
          overridden_by?: string;
          task_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "task_warnings_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_warnings_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_warnings_overridden_by_fkey";
            columns: ["overridden_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_warnings_overridden_by_fkey";
            columns: ["overridden_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "task_warnings_task_id_fkey";
            columns: ["task_id"];
            isOneToOne: false;
            referencedRelation: "tasks";
            referencedColumns: ["id"];
          },
        ];
      };
      tasks: {
        Row: {
          admin_approved_at: string | null;
          admin_step: Database["public"]["Enums"]["admin_step"];
          approving_admin_id: string | null;
          archived_at: string | null;
          cancelled_at: string | null;
          cancelled_reason: string | null;
          client_id: string | null;
          completed_at: string | null;
          created_at: string;
          created_by: string;
          custom_fields: Json;
          description: string | null;
          due_at: string;
          event_date: string | null;
          event_end_at: string | null;
          event_start_at: string | null;
          id: string;
          late_reason: string | null;
          location: string | null;
          org_id: string;
          primary_owner_id: string;
          priority: Database["public"]["Enums"]["priority"];
          purpose: string | null;
          reminder_rules: Json;
          search: unknown;
          state: Database["public"]["Enums"]["task_state"];
          submitted_at: string | null;
          submitted_by: string | null;
          submitted_on_behalf_of: string | null;
          task_type_id: string;
          template_id: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          admin_approved_at?: string | null;
          admin_step?: Database["public"]["Enums"]["admin_step"];
          approving_admin_id?: string | null;
          archived_at?: string | null;
          cancelled_at?: string | null;
          cancelled_reason?: string | null;
          client_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by: string;
          custom_fields?: Json;
          description?: string | null;
          due_at: string;
          event_date?: string | null;
          event_end_at?: string | null;
          event_start_at?: string | null;
          id?: string;
          late_reason?: string | null;
          location?: string | null;
          org_id?: string;
          primary_owner_id: string;
          priority?: Database["public"]["Enums"]["priority"];
          purpose?: string | null;
          reminder_rules?: Json;
          search?: unknown;
          state?: Database["public"]["Enums"]["task_state"];
          submitted_at?: string | null;
          submitted_by?: string | null;
          submitted_on_behalf_of?: string | null;
          task_type_id: string;
          template_id?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          admin_approved_at?: string | null;
          admin_step?: Database["public"]["Enums"]["admin_step"];
          approving_admin_id?: string | null;
          archived_at?: string | null;
          cancelled_at?: string | null;
          cancelled_reason?: string | null;
          client_id?: string | null;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string;
          custom_fields?: Json;
          description?: string | null;
          due_at?: string;
          event_date?: string | null;
          event_end_at?: string | null;
          event_start_at?: string | null;
          id?: string;
          late_reason?: string | null;
          location?: string | null;
          org_id?: string;
          primary_owner_id?: string;
          priority?: Database["public"]["Enums"]["priority"];
          purpose?: string | null;
          reminder_rules?: Json;
          search?: unknown;
          state?: Database["public"]["Enums"]["task_state"];
          submitted_at?: string | null;
          submitted_by?: string | null;
          submitted_on_behalf_of?: string | null;
          task_type_id?: string;
          template_id?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_approving_admin_id_fkey";
            columns: ["approving_admin_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_approving_admin_id_fkey";
            columns: ["approving_admin_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "client_labels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey";
            columns: ["primary_owner_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey";
            columns: ["primary_owner_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_submitted_by_fkey";
            columns: ["submitted_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_submitted_by_fkey";
            columns: ["submitted_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_submitted_on_behalf_of_fkey";
            columns: ["submitted_on_behalf_of"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_submitted_on_behalf_of_fkey";
            columns: ["submitted_on_behalf_of"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_task_type_id_fkey";
            columns: ["task_type_id"];
            isOneToOne: false;
            referencedRelation: "task_types";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tasks_template_id_fkey";
            columns: ["template_id"];
            isOneToOne: false;
            referencedRelation: "task_templates";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      client_labels: {
        Row: {
          brand_notes: string | null;
          colors: Json | null;
          fonts: Json | null;
          id: string | null;
          logo_file_id: string | null;
          name: string | null;
          state: Database["public"]["Enums"]["client_state"] | null;
          tone_of_voice: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "client_brand_logo_file_id_fkey";
            columns: ["logo_file_id"];
            isOneToOne: false;
            referencedRelation: "files";
            referencedColumns: ["id"];
          },
        ];
      };
      coordinated_freelancers: {
        Row: {
          coordinator_id: string | null;
          created_at: string | null;
          from_at: string | null;
          id: string | null;
          member_id: string | null;
          set_by: string | null;
          to_at: string | null;
        };
        Insert: {
          coordinator_id?: string | null;
          created_at?: string | null;
          from_at?: string | null;
          id?: string | null;
          member_id?: string | null;
          set_by?: string | null;
          to_at?: string | null;
        };
        Update: {
          coordinator_id?: string | null;
          created_at?: string | null;
          from_at?: string | null;
          id?: string | null;
          member_id?: string | null;
          set_by?: string | null;
          to_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "member_coordinators_coordinator_id_fkey";
            columns: ["coordinator_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_coordinators_coordinator_id_fkey";
            columns: ["coordinator_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_coordinators_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_coordinators_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_coordinators_set_by_fkey";
            columns: ["set_by"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_coordinators_set_by_fkey";
            columns: ["set_by"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      freelancer_coordinators: {
        Row: {
          coordinator_id: string | null;
          from_at: string | null;
          member_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "member_coordinators_coordinator_id_fkey";
            columns: ["coordinator_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_coordinators_coordinator_id_fkey";
            columns: ["coordinator_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_coordinators_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "member_directory";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "member_coordinators_member_id_fkey";
            columns: ["member_id"];
            isOneToOne: false;
            referencedRelation: "members";
            referencedColumns: ["id"];
          },
        ];
      };
      member_directory: {
        Row: {
          avatar_file_id: string | null;
          created_at: string | null;
          engagement: Database["public"]["Enums"]["engagement"] | null;
          full_name: string | null;
          id: string | null;
          job_title_id: string | null;
          org_id: string | null;
          phone: string | null;
          role: Database["public"]["Enums"]["member_role"] | null;
          status: Database["public"]["Enums"]["member_status"] | null;
        };
        Insert: {
          avatar_file_id?: string | null;
          created_at?: string | null;
          engagement?: Database["public"]["Enums"]["engagement"] | null;
          full_name?: string | null;
          id?: string | null;
          job_title_id?: string | null;
          org_id?: string | null;
          phone?: never;
          role?: Database["public"]["Enums"]["member_role"] | null;
          status?: Database["public"]["Enums"]["member_status"] | null;
        };
        Update: {
          avatar_file_id?: string | null;
          created_at?: string | null;
          engagement?: Database["public"]["Enums"]["engagement"] | null;
          full_name?: string | null;
          id?: string | null;
          job_title_id?: string | null;
          org_id?: string | null;
          phone?: never;
          role?: Database["public"]["Enums"]["member_role"] | null;
          status?: Database["public"]["Enums"]["member_status"] | null;
        };
        Relationships: [
          {
            foreignKeyName: "members_avatar_file_id_fkey";
            columns: ["avatar_file_id"];
            isOneToOne: false;
            referencedRelation: "files";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "members_job_title_id_fkey";
            columns: ["job_title_id"];
            isOneToOne: false;
            referencedRelation: "list_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "members_org_id_fkey";
            columns: ["org_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      app_open_report: {
        Args: { is_standalone: boolean; platform: string };
        Returns: boolean;
      };
      attendance_choose_leave_today: {
        Args: {
          choice: Database["public"]["Enums"]["attendance_choice"];
          reason?: string;
        };
        Returns: Database["public"]["Enums"]["attendance_state"];
      };
      attendance_decide: {
        Args: {
          day_id: string;
          decision: string;
          reason?: string;
          status?: Database["public"]["Enums"]["day_status"];
        };
        Returns: Database["public"]["Enums"]["attendance_state"];
      };
      attendance_end_day: {
        Args: { overtime_minutes?: number; overtime_note?: string };
        Returns: {
          day_id: string;
          note_id: string;
          work_date: string;
        }[];
      };
      attendance_flag_overtime: {
        Args: { day_id: string; reason?: string };
        Returns: boolean;
      };
      attendance_flag_overtime_today: {
        Args: { reason?: string };
        Returns: string;
      };
      attendance_own_today: {
        Args: never;
        Returns: {
          attendance_started: boolean;
          covering_leave_type: Database["public"]["Enums"]["leave_type"];
          day_id: string;
          decided_by_system: boolean;
          decision_reason: string;
          end_not_recorded: boolean;
          ended_at: string;
          final_status: Database["public"]["Enums"]["day_status"];
          is_day_off: boolean;
          is_working_day: boolean;
          leave_type: Database["public"]["Enums"]["leave_type"];
          overtime_flag: boolean;
          overtime_reason: string;
          proposed_by_system: boolean;
          started_at: string;
          state: Database["public"]["Enums"]["attendance_state"];
          submitted_choice: Database["public"]["Enums"]["attendance_choice"];
          work_date: string;
          worked_on_leave: boolean;
          yesterday_open_day_id: string;
          yesterday_started_at: string;
        }[];
      };
      attendance_start_day: { Args: never; Returns: string };
      attendance_submit: {
        Args: {
          choice: Database["public"]["Enums"]["attendance_choice"];
          for_date?: string;
          reason?: string;
        };
        Returns: Database["public"]["Enums"]["attendance_state"];
      };
      attendance_today_detail: {
        Args: never;
        Returns: {
          day_id: string;
          end_not_recorded: boolean;
          ended_at: string;
          final_status: Database["public"]["Enums"]["day_status"];
          full_name: string;
          is_day_off: boolean;
          job_title: string;
          leave_type: Database["public"]["Enums"]["leave_type"];
          member_id: string;
          on_leave: boolean;
          overtime_flag: boolean;
          proposed_by_system: boolean;
          started: boolean;
          started_at: string;
          state: Database["public"]["Enums"]["attendance_state"];
          submitted_choice: Database["public"]["Enums"]["attendance_choice"];
        }[];
      };
      bootstrap_owner: {
        Args: {
          email: string;
          full_name: string;
          org_name: string;
          user_id: string;
        };
        Returns: string;
      };
      client_activate: {
        Args: { client_id: string };
        Returns: Database["public"]["Enums"]["client_state"];
      };
      client_assign_admin: {
        Args: { admin_id: string; client_id: string };
        Returns: string;
      };
      client_close: {
        Args: { client_id: string; reason?: string };
        Returns: Database["public"]["Enums"]["client_state"];
      };
      client_contact_archive: {
        Args: { contact_id: string; next_primary_id?: string };
        Returns: undefined;
      };
      client_contact_restore: {
        Args: { contact_id: string };
        Returns: undefined;
      };
      client_contact_set_primary: {
        Args: { contact_id: string };
        Returns: undefined;
      };
      client_hand_over: {
        Args: { from_admin: string; moves: Json };
        Returns: number;
      };
      client_pause: {
        Args: { client_id: string };
        Returns: Database["public"]["Enums"]["client_state"];
      };
      client_reactivate: {
        Args: { client_id: string };
        Returns: Database["public"]["Enums"]["client_state"];
      };
      comp_leave_balance: {
        Args: { member_id?: string };
        Returns: {
          available_days: number;
          use_by: string;
        }[];
      };
      comp_leave_dates: {
        Args: never;
        Returns: {
          available_days: number;
          work_date: string;
        }[];
      };
      comp_leave_grant: {
        Args: {
          days: number;
          member_id: string;
          note?: string;
          request_key?: string;
        };
        Returns: string;
      };
      comp_leave_revoke: {
        Args: { credit_id: string; reason?: string };
        Returns: undefined;
      };
      digest_daily: { Args: { p_now?: string }; Returns: number };
      email_claim: {
        Args: { p_limit?: number; p_now?: string };
        Returns: {
          attempts: number;
          batch_id: string;
          body: string;
          delivery_id: string;
          email: string;
          escalation_level: number;
          kind: string;
          link: string;
          notification_id: string;
          payload: Json;
          recipient_id: string;
          title: string;
        }[];
      };
      email_record: {
        Args: {
          p_error?: string;
          p_id: string;
          p_now?: string;
          p_outcome: string;
        };
        Returns: number;
      };
      expense_claim_decide: {
        Args: { claim_id: string; decision: string; reason?: string };
        Returns: string;
      };
      expense_claim_mark_paid: {
        Args: { claim_id: string; paid_on?: string };
        Returns: string;
      };
      expense_claim_submit: {
        Args: {
          amount: number;
          category_id: string;
          expense_date: string;
          note: string;
          receipt_file_id?: string;
        };
        Returns: string;
      };
      expense_claim_withdraw: { Args: { claim_id: string }; Returns: string };
      extra_work_note_decide: {
        Args: {
          days?: number;
          decision: string;
          mark_day_worked?: boolean;
          note?: string;
          note_id: string;
        };
        Returns: string;
      };
      extra_work_note_submit: {
        Args: {
          duration_minutes?: number;
          kind: string;
          note: string;
          work_date: string;
        };
        Returns: string;
      };
      file_begin: {
        Args: {
          file_id: string;
          mime: string;
          name: string;
          preview_of?: string;
          size_bytes: number;
          uploader: string;
        };
        Returns: {
          archived_at: string | null;
          created_at: string;
          id: string;
          mime: string;
          name: string;
          org_id: string;
          preview_of: string | null;
          sha256: string | null;
          size_bytes: number;
          status: string;
          storage_key: string;
          updated_at: string;
          uploaded_by: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "files";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      file_cleanup_candidates: {
        Args: {
          archived_before: string;
          batch?: number;
          orphaned_before: string;
          pending_before: string;
        };
        Returns: {
          archived_at: string | null;
          created_at: string;
          id: string;
          mime: string;
          name: string;
          org_id: string;
          preview_of: string | null;
          sha256: string | null;
          size_bytes: number;
          status: string;
          storage_key: string;
          updated_at: string;
          uploaded_by: string | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "files";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      file_complete: {
        Args: {
          file_id: string;
          sha256?: string;
          size_bytes: number;
          uploader: string;
        };
        Returns: string;
      };
      file_fail: { Args: { file_id: string }; Returns: string };
      file_mark_deleted: { Args: { file_id: string }; Returns: string };
      leave_decide: {
        Args: { decision: string; reason?: string; request_id: string };
        Returns: {
          kept_dates: string[];
          state: Database["public"]["Enums"]["leave_state"];
        }[];
      };
      leave_owner_cancel: {
        Args: { reason?: string; request_id: string };
        Returns: Database["public"]["Enums"]["leave_state"];
      };
      leave_owner_edit: {
        Args: {
          end_date: string;
          reason?: string;
          request_id: string;
          start_date: string;
          type: Database["public"]["Enums"]["leave_type"];
        };
        Returns: {
          kept_dates: string[];
          new_id: string;
        }[];
      };
      leave_request_change: {
        Args: {
          cancel?: boolean;
          end_date?: string;
          reason?: string;
          request_id: string;
          start_date?: string;
          type?: Database["public"]["Enums"]["leave_type"];
        };
        Returns: string;
      };
      leave_submit: {
        Args: {
          end_date: string;
          reason?: string;
          start_date: string;
          type: Database["public"]["Enums"]["leave_type"];
        };
        Returns: string;
      };
      leave_submit_comp: {
        Args: { half_day?: boolean; reason?: string; start_date: string };
        Returns: string;
      };
      leave_withdraw: {
        Args: { request_id: string };
        Returns: Database["public"]["Enums"]["leave_state"];
      };
      list_item_move: {
        Args: { direction: string; item_id: string; list_key: string };
        Returns: string;
      };
      member_accept_invite: { Args: never; Returns: string };
      member_add_freelancer: {
        Args: {
          coordinator_id?: string;
          full_name: string;
          job_title_id?: string;
          phone?: string;
        };
        Returns: string;
      };
      member_availability: {
        Args: { from_date: string; member_ids?: string[]; to_date: string };
        Returns: {
          day: string;
          engagement: Database["public"]["Enums"]["engagement"];
          event_blocks: Json;
          leave: string;
          member_id: string;
          open_tasks_due: number;
          present: boolean;
        }[];
      };
      member_change_email: {
        Args: { member_id: string; new_email: string };
        Returns: string;
      };
      member_deactivate: {
        Args: { member_id: string; reason?: string };
        Returns: string;
      };
      member_invite: {
        Args: {
          email: string;
          full_name: string;
          job_title_id?: string;
          role: Database["public"]["Enums"]["member_role"];
          user_id: string;
        };
        Returns: string;
      };
      member_invite_employee: {
        Args: { email: string; member_id: string };
        Returns: string;
      };
      member_invite_refresh: { Args: { member_id: string }; Returns: string };
      member_reactivate: { Args: { member_id: string }; Returns: string };
      member_self_status: {
        Args: never;
        Returns: Database["public"]["Enums"]["member_status"];
      };
      member_set_coordinator: {
        Args: { coordinator_id: string; member_id: string; reason?: string };
        Returns: string;
      };
      month_summary: {
        Args: { member_id?: string; month: string };
        Returns: {
          absent_days: number;
          additional_leave: number;
          comp_leave_days: number;
          credits_expired: number;
          credits_granted: number;
          credits_used: number;
          days_off_worked: number;
          days_worked: number;
          full_name: string;
          half_days: number;
          id: string;
          leave_days: number;
          overtime_granted: number;
          overtime_notes: number;
          pending_days: number;
          present_days: number;
          role: Database["public"]["Enums"]["member_role"];
          status: Database["public"]["Enums"]["member_status"];
          working_days: number;
        }[];
      };
      notifications_inbox: {
        Args: { p_limit: number; p_offset: number; p_unread_only: boolean };
        Returns: {
          body: string;
          created_at: string;
          id: string;
          kind: string;
          link: string;
          run_kinds: string[];
          run_size: number;
          run_unread: string[];
          title: string;
          total: number;
        }[];
      };
      notifications_mark_all_read: { Args: never; Returns: number };
      notifications_mark_read: {
        Args: { entity: string; entity_id: string };
        Returns: number;
      };
      notifications_remove_read: {
        Args: { p_dry_run?: boolean; p_now?: string };
        Returns: {
          deliveries: number;
          notifications: number;
        }[];
      };
      onboarding_finish: { Args: { p_via: string }; Returns: boolean };
      owner_digest_preview: { Args: never; Returns: Json };
      push_claim: {
        Args: { p_limit?: number; p_now?: string };
        Returns: {
          attempts: number;
          body: string;
          delivery_ids: string[];
          held_count: number;
          is_summary: boolean;
          kind: string;
          link: string;
          notification_id: string;
          org_id: string;
          recipient_id: string;
          title: string;
        }[];
      };
      push_quiet: { Args: { p_at: string; p_org: string }; Returns: boolean };
      push_record: {
        Args: {
          p_error?: string;
          p_ids: string[];
          p_now?: string;
          p_outcome: string;
        };
        Returns: number;
      };
      push_status_own: {
        Args: never;
        Returns: {
          band: string;
          endpoints: string[];
        }[];
      };
      push_subscription_remove: { Args: { endpoint: string }; Returns: boolean };
      push_subscription_remove_own: { Args: { p_id: string }; Returns: boolean };
      push_subscription_result: {
        Args: { p_id: string; p_now?: string; p_outcome: string };
        Returns: string;
      };
      push_subscription_upsert: {
        Args: {
          auth: string;
          endpoint: string;
          is_standalone?: boolean;
          label?: string;
          p256dh: string;
          platform?: string;
          user_agent?: string;
        };
        Returns: string;
      };
      push_subscriptions_tested: { Args: never; Returns: number };
      push_targets: {
        Args: { p_recipient: string };
        Returns: {
          auth: string;
          endpoint: string;
          id: string;
          p256dh: string;
        }[];
      };
      push_test_claim: { Args: never; Returns: number };
      reachability_check: { Args: { p_now?: string }; Returns: number };
      reachability_overview: {
        Args: never;
        Returns: {
          full_name: string;
          last_success_at: string;
          member_id: string;
          platform: string;
          role: Database["public"]["Enums"]["member_role"];
          since: string;
          state: string;
        }[];
      };
      session_login: {
        Args: { ip_hash?: string; user_agent?: string };
        Returns: string;
      };
      session_sign_out: {
        Args: { ip_hash?: string; user_agent?: string };
        Returns: string;
      };
      task_acknowledge: {
        Args: { on_behalf_of?: string; task_id: string };
        Returns: string;
      };
      task_cancel: {
        Args: { reason: string; task_id: string };
        Returns: Database["public"]["Enums"]["task_state"];
      };
      task_counts: {
        Args: never;
        Returns: {
          badge: number;
          changes_requested: number;
          not_noted: number;
          to_decide: number;
        }[];
      };
      task_create: {
        Args: {
          approving_admin_id?: string;
          assignee_ids: string[];
          client_id: string;
          custom_fields?: Json;
          description: string;
          due_at: string;
          event_date?: string;
          event_end_at?: string;
          event_start_at?: string;
          location?: string;
          primary_owner_id: string;
          priority: Database["public"]["Enums"]["priority"];
          purpose?: string;
          reminder_rules?: Json;
          stages?: string[];
          task_type_id: string;
          template_id?: string;
          title: string;
          warnings?: Json;
        };
        Returns: string;
      };
      task_mark_read: {
        Args: { task_id: string; up_to?: string };
        Returns: string;
      };
      task_reopen: {
        Args: { reason: string; task_id: string };
        Returns: Database["public"]["Enums"]["task_state"];
      };
      task_request_convert: {
        Args: {
          approving_admin_id?: string;
          assignee_ids: string[];
          client_id: string;
          custom_fields?: Json;
          description: string;
          due_at: string;
          event_date?: string;
          event_end_at?: string;
          event_start_at?: string;
          location?: string;
          primary_owner_id: string;
          priority: Database["public"]["Enums"]["priority"];
          purpose?: string;
          reminder_rules?: Json;
          request_id: string;
          stages?: string[];
          task_type_id: string;
          template_id?: string;
          title: string;
          warnings?: Json;
        };
        Returns: string;
      };
      task_request_create: {
        Args: { client_id?: string; details?: string; title: string };
        Returns: string;
      };
      task_request_decline: {
        Args: { reason: string; request_id: string };
        Returns: Database["public"]["Enums"]["request_state"];
      };
      task_request_withdraw: {
        Args: { request_id: string };
        Returns: Database["public"]["Enums"]["request_state"];
      };
      task_review: {
        Args: {
          decision: Database["public"]["Enums"]["review_decision"];
          reason?: string;
          task_id: string;
        };
        Returns: Database["public"]["Enums"]["task_state"];
      };
      task_set_approver: {
        Args: { approving_admin_id: string; task_id: string };
        Returns: Database["public"]["Enums"]["task_state"];
      };
      task_start: {
        Args: { on_behalf_of?: string; task_id: string };
        Returns: Database["public"]["Enums"]["task_state"];
      };
      task_submit_done: {
        Args: {
          late_reason?: string;
          note?: string;
          on_behalf_of?: string;
          task_id: string;
        };
        Returns: Database["public"]["Enums"]["task_state"];
      };
      task_type_move: {
        Args: { direction: string; task_type_id: string };
        Returns: string;
      };
      task_unread_counts: {
        Args: { task_ids?: string[] };
        Returns: {
          task_id: string;
          unread: number;
        }[];
      };
      task_update_assignment: {
        Args: { changes: Json; task_id: string; warnings?: Json };
        Returns: string[];
      };
    };
    Enums: {
      admin_step: "required" | "none" | "skipped";
      attendance_choice: "present" | "leave" | "half_day" | "comp_leave";
      attendance_state: "awaiting_choice" | "pending_review" | "approved" | "corrected";
      client_state: "draft" | "active" | "paused" | "inactive";
      day_status: "present" | "leave" | "half_day" | "comp_leave" | "absent";
      engagement: "permanent" | "freelance";
      field_type:
        | "text"
        | "long_text"
        | "number"
        | "date"
        | "datetime"
        | "checkbox"
        | "select"
        | "multi_select"
        | "url"
        | "email"
        | "phone"
        | "color"
        | "member"
        | "rating";
      leave_state: "submitted" | "approved" | "rejected" | "withdrawn" | "superseded" | "cancelled";
      leave_type: "leave" | "half_day" | "comp_leave";
      member_role: "owner" | "admin" | "staff";
      member_status: "invited" | "active" | "deactivated";
      priority: "low" | "medium" | "high" | "urgent";
      request_state: "pending" | "converted" | "declined" | "withdrawn";
      review_decision: "approved" | "rejected";
      task_state:
        | "todo"
        | "in_progress"
        | "submitted"
        | "admin_approved"
        | "changes_requested"
        | "completed"
        | "cancelled";
      task_type_kind: "normal" | "event" | "custom";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      admin_step: ["required", "none", "skipped"],
      attendance_choice: ["present", "leave", "half_day", "comp_leave"],
      attendance_state: ["awaiting_choice", "pending_review", "approved", "corrected"],
      client_state: ["draft", "active", "paused", "inactive"],
      day_status: ["present", "leave", "half_day", "comp_leave", "absent"],
      engagement: ["permanent", "freelance"],
      field_type: [
        "text",
        "long_text",
        "number",
        "date",
        "datetime",
        "checkbox",
        "select",
        "multi_select",
        "url",
        "email",
        "phone",
        "color",
        "member",
        "rating",
      ],
      leave_state: ["submitted", "approved", "rejected", "withdrawn", "superseded", "cancelled"],
      leave_type: ["leave", "half_day", "comp_leave"],
      member_role: ["owner", "admin", "staff"],
      member_status: ["invited", "active", "deactivated"],
      priority: ["low", "medium", "high", "urgent"],
      request_state: ["pending", "converted", "declined", "withdrawn"],
      review_decision: ["approved", "rejected"],
      task_state: [
        "todo",
        "in_progress",
        "submitted",
        "admin_approved",
        "changes_requested",
        "completed",
        "cancelled",
      ],
      task_type_kind: ["normal", "event", "custom"],
    },
  },
} as const;
