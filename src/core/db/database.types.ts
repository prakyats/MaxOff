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
      members: {
        Row: {
          created_at: string;
          deactivated_at: string | null;
          email: string;
          full_name: string;
          id: string;
          invited_at: string;
          joined_at: string | null;
          org_id: string;
          phone: string | null;
          role: Database["public"]["Enums"]["member_role"];
          status: Database["public"]["Enums"]["member_status"];
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          deactivated_at?: string | null;
          email: string;
          full_name: string;
          id: string;
          invited_at?: string;
          joined_at?: string | null;
          org_id?: string;
          phone?: string | null;
          role: Database["public"]["Enums"]["member_role"];
          status?: Database["public"]["Enums"]["member_status"];
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          deactivated_at?: string | null;
          email?: string;
          full_name?: string;
          id?: string;
          invited_at?: string;
          joined_at?: string | null;
          org_id?: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["member_role"];
          status?: Database["public"]["Enums"]["member_status"];
          updated_at?: string;
        };
        Relationships: [
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
          ack_escalate_ceo_hours: number;
          ack_escalate_hours: number;
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
          ack_escalate_ceo_hours?: number;
          ack_escalate_hours?: number;
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
          ack_escalate_ceo_hours?: number;
          ack_escalate_hours?: number;
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
          name: string;
          timezone: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [];
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
      member_directory: {
        Row: {
          created_at: string | null;
          full_name: string | null;
          id: string | null;
          org_id: string | null;
          phone: string | null;
          role: Database["public"]["Enums"]["member_role"] | null;
          status: Database["public"]["Enums"]["member_status"] | null;
        };
        Insert: {
          created_at?: string | null;
          full_name?: string | null;
          id?: string | null;
          org_id?: string | null;
          phone?: string | null;
          role?: Database["public"]["Enums"]["member_role"] | null;
          status?: Database["public"]["Enums"]["member_status"] | null;
        };
        Update: {
          created_at?: string | null;
          full_name?: string | null;
          id?: string | null;
          org_id?: string | null;
          phone?: string | null;
          role?: Database["public"]["Enums"]["member_role"] | null;
          status?: Database["public"]["Enums"]["member_status"] | null;
        };
        Relationships: [
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
      bootstrap_ceo: {
        Args: {
          email: string;
          full_name: string;
          org_name: string;
          user_id: string;
        };
        Returns: string;
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
      member_role: "ceo" | "admin" | "staff";
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
      member_role: ["ceo", "admin", "staff"],
      member_status: ["invited", "active", "deactivated"],
    },
  },
} as const;
