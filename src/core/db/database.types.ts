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
          final_status: Database["public"]["Enums"]["day_status"] | null;
          first_login_at: string | null;
          id: string;
          is_day_off: boolean;
          last_logout_at: string | null;
          leave_request_id: string | null;
          logout_not_recorded: boolean;
          member_id: string;
          overtime_flag: boolean;
          overtime_reason: string | null;
          proposed_by_system: boolean;
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
          final_status?: Database["public"]["Enums"]["day_status"] | null;
          first_login_at?: string | null;
          id?: string;
          is_day_off?: boolean;
          last_logout_at?: string | null;
          leave_request_id?: string | null;
          logout_not_recorded?: boolean;
          member_id: string;
          overtime_flag?: boolean;
          overtime_reason?: string | null;
          proposed_by_system?: boolean;
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
          final_status?: Database["public"]["Enums"]["day_status"] | null;
          first_login_at?: string | null;
          id?: string;
          is_day_off?: boolean;
          last_logout_at?: string | null;
          leave_request_id?: string | null;
          logout_not_recorded?: boolean;
          member_id?: string;
          overtime_flag?: boolean;
          overtime_reason?: string | null;
          proposed_by_system?: boolean;
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
      members: {
        Row: {
          avatar_file_id: string | null;
          created_at: string;
          deactivated_at: string | null;
          email: string;
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
          email: string;
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
          email?: string;
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
      org_settings: {
        Row: {
          ack_escalate_hours: number;
          ack_escalate_owner_hours: number;
          ack_repeat_hours: number;
          created_at: string;
          default_task_reminders: Json;
          email_daily_cap_per_member: number;
          logout_reminder_time: string;
          org_id: string;
          overdue_escalate_hours: number;
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
          email_daily_cap_per_member?: number;
          logout_reminder_time?: string;
          org_id: string;
          overdue_escalate_hours?: number;
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
          email_daily_cap_per_member?: number;
          logout_reminder_time?: string;
          org_id?: string;
          overdue_escalate_hours?: number;
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
      member_directory: {
        Row: {
          avatar_file_id: string | null;
          created_at: string | null;
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
          full_name?: string | null;
          id?: string | null;
          job_title_id?: string | null;
          org_id?: string | null;
          phone?: string | null;
          role?: Database["public"]["Enums"]["member_role"] | null;
          status?: Database["public"]["Enums"]["member_status"] | null;
        };
        Update: {
          avatar_file_id?: string | null;
          created_at?: string | null;
          full_name?: string | null;
          id?: string | null;
          job_title_id?: string | null;
          org_id?: string | null;
          phone?: string | null;
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
      attendance_decide: {
        Args: {
          day_id: string;
          decision: string;
          reason?: string;
          status?: Database["public"]["Enums"]["day_status"];
        };
        Returns: Database["public"]["Enums"]["attendance_state"];
      };
      attendance_flag_overtime: {
        Args: { day_id: string; reason?: string };
        Returns: boolean;
      };
      attendance_flag_overtime_today: {
        Args: { reason?: string };
        Returns: string;
      };
      attendance_submit: {
        Args: {
          choice: Database["public"]["Enums"]["attendance_choice"];
          for_date?: string;
          reason?: string;
        };
        Returns: Database["public"]["Enums"]["attendance_state"];
      };
      attendance_today: {
        Args: never;
        Returns: {
          day_id: string;
          final_status: Database["public"]["Enums"]["day_status"];
          first_login_at: string;
          full_name: string;
          is_day_off: boolean;
          job_title: string;
          last_logout_at: string;
          leave_type: Database["public"]["Enums"]["leave_type"];
          logout_not_recorded: boolean;
          member_id: string;
          on_leave: boolean;
          overtime_flag: boolean;
          proposed_by_system: boolean;
          started: boolean;
          state: Database["public"]["Enums"]["attendance_state"];
          submitted_choice: Database["public"]["Enums"]["attendance_choice"];
        }[];
      };
      attendance_touch: {
        Args: { ip_hash?: string; user_agent?: string };
        Returns: {
          day_id: string;
          final_status: Database["public"]["Enums"]["day_status"];
          gate_required: boolean;
          is_day_off: boolean;
          leave_request_id: string;
          proposed_by_system: boolean;
          state: Database["public"]["Enums"]["attendance_state"];
          work_date: string;
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
      client_pause: {
        Args: { client_id: string };
        Returns: Database["public"]["Enums"]["client_state"];
      };
      client_reactivate: {
        Args: { client_id: string };
        Returns: Database["public"]["Enums"]["client_state"];
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
      leave_withdraw: {
        Args: { request_id: string };
        Returns: Database["public"]["Enums"]["leave_state"];
      };
      list_item_move: {
        Args: { direction: string; item_id: string; list_key: string };
        Returns: string;
      };
      member_accept_invite: { Args: never; Returns: string };
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
      member_invite_refresh: { Args: { member_id: string }; Returns: string };
      member_reactivate: { Args: { member_id: string }; Returns: string };
      member_self_status: {
        Args: never;
        Returns: Database["public"]["Enums"]["member_status"];
      };
      session_login: {
        Args: { ip_hash?: string; user_agent?: string };
        Returns: string;
      };
      session_logout: {
        Args: { ip_hash?: string; user_agent?: string };
        Returns: string;
      };
    };
    Enums: {
      attendance_choice: "present" | "leave" | "half_day" | "comp_leave";
      attendance_state: "awaiting_choice" | "pending_review" | "approved" | "corrected";
      client_state: "draft" | "active" | "paused" | "inactive";
      day_status: "present" | "leave" | "half_day" | "comp_leave" | "absent";
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
      attendance_choice: ["present", "leave", "half_day", "comp_leave"],
      attendance_state: ["awaiting_choice", "pending_review", "approved", "corrected"],
      client_state: ["draft", "active", "paused", "inactive"],
      day_status: ["present", "leave", "half_day", "comp_leave", "absent"],
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
    },
  },
} as const;
