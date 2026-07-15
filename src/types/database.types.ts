export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          summary: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          summary?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
        ]
      }
      app_settings: {
        Row: {
          address: Json
          company_name: string
          contact_email: string | null
          contact_phone: string | null
          default_currency: string
          default_payment_terms: Database["public"]["Enums"]["payment_terms"]
          default_tax_rate: number
          id: boolean
          invoice_footer: string | null
          invoice_number_prefix: string
          invoice_prefix: string
          invoice_terms: string | null
          logo_path: string | null
          payment_instructions: string | null
          po_prefix: string
          remittance_details: string | null
          updated_at: string
        }
        Insert: {
          address?: Json
          company_name?: string
          contact_email?: string | null
          contact_phone?: string | null
          default_currency?: string
          default_payment_terms?: Database["public"]["Enums"]["payment_terms"]
          default_tax_rate?: number
          id?: boolean
          invoice_footer?: string | null
          invoice_number_prefix?: string
          invoice_prefix?: string
          invoice_terms?: string | null
          logo_path?: string | null
          payment_instructions?: string | null
          po_prefix?: string
          remittance_details?: string | null
          updated_at?: string
        }
        Update: {
          address?: Json
          company_name?: string
          contact_email?: string | null
          contact_phone?: string | null
          default_currency?: string
          default_payment_terms?: Database["public"]["Enums"]["payment_terms"]
          default_tax_rate?: number
          id?: boolean
          invoice_footer?: string | null
          invoice_number_prefix?: string
          invoice_prefix?: string
          invoice_terms?: string | null
          logo_path?: string | null
          payment_instructions?: string | null
          po_prefix?: string
          remittance_details?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      catalog_import_batches: {
        Row: {
          committed_at: string | null
          costs_updated: number
          created_at: string
          error: string | null
          error_report_path: string | null
          file_type: string | null
          filename: string
          id: string
          kind: string
          mode: string | null
          products_created: number
          products_updated: number
          row_count: number
          rows_skipped: number
          status: Database["public"]["Enums"]["import_status"]
          storage_path: string
          summary: Json
          uploaded_by: string | null
          worksheet: string | null
        }
        Insert: {
          committed_at?: string | null
          costs_updated?: number
          created_at?: string
          error?: string | null
          error_report_path?: string | null
          file_type?: string | null
          filename: string
          id?: string
          kind?: string
          mode?: string | null
          products_created?: number
          products_updated?: number
          row_count?: number
          rows_skipped?: number
          status?: Database["public"]["Enums"]["import_status"]
          storage_path: string
          summary?: Json
          uploaded_by?: string | null
          worksheet?: string | null
        }
        Update: {
          committed_at?: string | null
          costs_updated?: number
          created_at?: string
          error?: string | null
          error_report_path?: string | null
          file_type?: string | null
          filename?: string
          id?: string
          kind?: string
          mode?: string | null
          products_created?: number
          products_updated?: number
          row_count?: number
          rows_skipped?: number
          status?: Database["public"]["Enums"]["import_status"]
          storage_path?: string
          summary?: Json
          uploaded_by?: string | null
          worksheet?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_import_batches_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "catalog_import_batches_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
        ]
      }
      catalog_import_rows: {
        Row: {
          batch_id: string
          classification: string | null
          created_at: string
          id: string
          messages: Json
          raw: Json
          row_number: number | null
          sku: string | null
          status: string | null
        }
        Insert: {
          batch_id: string
          classification?: string | null
          created_at?: string
          id?: string
          messages?: Json
          raw?: Json
          row_number?: number | null
          sku?: string | null
          status?: string | null
        }
        Update: {
          batch_id?: string
          classification?: string | null
          created_at?: string
          id?: string
          messages?: Json
          raw?: Json
          row_number?: number | null
          sku?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "catalog_import_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "catalog_import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      client_price_overrides: {
        Row: {
          active: boolean
          client_id: string
          created_at: string
          created_by: string | null
          currency: string
          effective_date: string
          effective_to: string | null
          expiration_date: string | null
          id: string
          max_quantity: number | null
          min_quantity: number
          note: string | null
          previous_price: number | null
          product_id: string
          reason: string | null
          selling_price: number
          source_import_batch: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          client_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          effective_date?: string
          effective_to?: string | null
          expiration_date?: string | null
          id?: string
          max_quantity?: number | null
          min_quantity?: number
          note?: string | null
          previous_price?: number | null
          product_id: string
          reason?: string | null
          selling_price: number
          source_import_batch?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          client_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          effective_date?: string
          effective_to?: string | null
          expiration_date?: string | null
          id?: string
          max_quantity?: number | null
          min_quantity?: number
          note?: string | null
          previous_price?: number | null
          product_id?: string
          reason?: string | null
          selling_price?: number
          source_import_batch?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_price_overrides_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_price_overrides_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_profit_by_client"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_price_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_price_overrides_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "client_price_overrides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_price_overrides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_price_overrides_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_price_overrides_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
        ]
      }
      client_pricing_assignments: {
        Row: {
          active: boolean
          assigned_by: string | null
          client_id: string
          created_at: string
          effective_date: string
          expiration_date: string | null
          id: string
          notes: string | null
          pricing_sheet_id: string | null
        }
        Insert: {
          active?: boolean
          assigned_by?: string | null
          client_id: string
          created_at?: string
          effective_date?: string
          expiration_date?: string | null
          id?: string
          notes?: string | null
          pricing_sheet_id?: string | null
        }
        Update: {
          active?: boolean
          assigned_by?: string | null
          client_id?: string
          created_at?: string
          effective_date?: string
          expiration_date?: string | null
          id?: string
          notes?: string | null
          pricing_sheet_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_pricing_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_pricing_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "client_pricing_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_pricing_assignments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_profit_by_client"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "client_pricing_assignments_pricing_sheet_id_fkey"
            columns: ["pricing_sheet_id"]
            isOneToOne: false
            referencedRelation: "pricing_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          assigned_rep_id: string | null
          billing_address: Json
          company_name: string
          created_at: string
          created_by: string | null
          default_pricing_sheet_id: string | null
          email: string | null
          id: string
          notes: string | null
          payment_terms: Database["public"]["Enums"]["payment_terms"]
          phone: string | null
          portal_user_id: string | null
          primary_contact_name: string | null
          shipping_address: Json
          status: Database["public"]["Enums"]["client_status"]
          updated_at: string
        }
        Insert: {
          assigned_rep_id?: string | null
          billing_address?: Json
          company_name: string
          created_at?: string
          created_by?: string | null
          default_pricing_sheet_id?: string | null
          email?: string | null
          id?: string
          notes?: string | null
          payment_terms?: Database["public"]["Enums"]["payment_terms"]
          phone?: string | null
          portal_user_id?: string | null
          primary_contact_name?: string | null
          shipping_address?: Json
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
        }
        Update: {
          assigned_rep_id?: string | null
          billing_address?: Json
          company_name?: string
          created_at?: string
          created_by?: string | null
          default_pricing_sheet_id?: string | null
          email?: string | null
          id?: string
          notes?: string | null
          payment_terms?: Database["public"]["Enums"]["payment_terms"]
          phone?: string | null
          portal_user_id?: string | null
          primary_contact_name?: string | null
          shipping_address?: Json
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_assigned_rep_id_fkey"
            columns: ["assigned_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_assigned_rep_id_fkey"
            columns: ["assigned_rep_id"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "fk_clients_pricing_sheet"
            columns: ["default_pricing_sheet_id"]
            isOneToOne: false
            referencedRelation: "pricing_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      commissions: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          basis_amount: number
          commission_type: Database["public"]["Enums"]["commission_type"]
          created_at: string
          created_by: string | null
          id: string
          invoice_gross_profit: number
          invoice_id: string
          invoice_subtotal: number
          note: string | null
          paid_at: string | null
          paid_by: string | null
          paid_method: Database["public"]["Enums"]["payment_method"] | null
          paid_note: string | null
          paid_reference: string | null
          payment_notes: string | null
          rate: number
          recipient_company: string | null
          recipient_email: string | null
          recipient_id: string | null
          recipient_name: string
          recipient_type: Database["public"]["Enums"]["commission_recipient_type"]
          status: Database["public"]["Enums"]["commission_status"]
          units: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          basis_amount?: number
          commission_type: Database["public"]["Enums"]["commission_type"]
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_gross_profit?: number
          invoice_id: string
          invoice_subtotal?: number
          note?: string | null
          paid_at?: string | null
          paid_by?: string | null
          paid_method?: Database["public"]["Enums"]["payment_method"] | null
          paid_note?: string | null
          paid_reference?: string | null
          payment_notes?: string | null
          rate: number
          recipient_company?: string | null
          recipient_email?: string | null
          recipient_id?: string | null
          recipient_name: string
          recipient_type?: Database["public"]["Enums"]["commission_recipient_type"]
          status?: Database["public"]["Enums"]["commission_status"]
          units?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          basis_amount?: number
          commission_type?: Database["public"]["Enums"]["commission_type"]
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_gross_profit?: number
          invoice_id?: string
          invoice_subtotal?: number
          note?: string | null
          paid_at?: string | null
          paid_by?: string | null
          paid_method?: Database["public"]["Enums"]["payment_method"] | null
          paid_note?: string | null
          paid_reference?: string | null
          payment_notes?: string | null
          rate?: number
          recipient_company?: string | null
          recipient_email?: string | null
          recipient_id?: string | null
          recipient_name?: string
          recipient_type?: Database["public"]["Enums"]["commission_recipient_type"]
          status?: Database["public"]["Enums"]["commission_status"]
          units?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commissions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "commissions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "commissions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ar_aging"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_outstanding_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "commissions_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "commissions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
        ]
      }
      document_sequences: {
        Row: {
          key: string
          next_value: number
        }
        Insert: {
          key: string
          next_value?: number
        }
        Update: {
          key?: string
          next_value?: number
        }
        Relationships: []
      }
      invoice_items: {
        Row: {
          coa_path: string | null
          created_at: string
          expiration_date: string | null
          id: string
          invoice_id: string
          line_gross_profit: number
          line_subtotal: number
          line_true_cost: number
          lot_number: string | null
          manual_reason: string | null
          manufacturer_name: string | null
          manufacturing_date: string | null
          original_unit_price: number | null
          pack_size: string | null
          price_overridden: boolean
          price_source: string | null
          price_source_sheet: string | null
          product_id: string | null
          product_name: string
          quantity: number
          retest_date: string | null
          sku: string
          strength: string | null
          unit_price: number
          unit_true_cost: number
        }
        Insert: {
          coa_path?: string | null
          created_at?: string
          expiration_date?: string | null
          id?: string
          invoice_id: string
          line_gross_profit?: number
          line_subtotal?: number
          line_true_cost?: number
          lot_number?: string | null
          manual_reason?: string | null
          manufacturer_name?: string | null
          manufacturing_date?: string | null
          original_unit_price?: number | null
          pack_size?: string | null
          price_overridden?: boolean
          price_source?: string | null
          price_source_sheet?: string | null
          product_id?: string | null
          product_name: string
          quantity: number
          retest_date?: string | null
          sku: string
          strength?: string | null
          unit_price: number
          unit_true_cost?: number
        }
        Update: {
          coa_path?: string | null
          created_at?: string
          expiration_date?: string | null
          id?: string
          invoice_id?: string
          line_gross_profit?: number
          line_subtotal?: number
          line_true_cost?: number
          lot_number?: string | null
          manual_reason?: string | null
          manufacturer_name?: string | null
          manufacturing_date?: string | null
          original_unit_price?: number | null
          pack_size?: string | null
          price_overridden?: boolean
          price_source?: string | null
          price_source_sheet?: string | null
          product_id?: string | null
          product_name?: string
          quantity?: number
          retest_date?: string | null
          sku?: string
          strength?: string | null
          unit_price?: number
          unit_true_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ar_aging"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_outstanding_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_status_history: {
        Row: {
          changed_by: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["invoice_status"] | null
          id: string
          invoice_id: string
          note: string | null
          to_status: Database["public"]["Enums"]["invoice_status"]
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["invoice_status"] | null
          id?: string
          invoice_id: string
          note?: string | null
          to_status: Database["public"]["Enums"]["invoice_status"]
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["invoice_status"] | null
          id?: string
          invoice_id?: string
          note?: string | null
          to_status?: Database["public"]["Enums"]["invoice_status"]
        }
        Relationships: [
          {
            foreignKeyName: "invoice_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "invoice_status_history_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_status_history_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ar_aging"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_status_history_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_status_history_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_outstanding_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_paid: number
          balance_due: number
          client_id: string | null
          client_snapshot: Json
          created_at: string
          created_by: string | null
          currency: string
          discount: number
          due_date: string | null
          fees: number
          fx_rate: number
          gross_margin: number
          gross_profit: number
          id: string
          invoice_number: string
          issue_date: string | null
          net_profit: number
          notes: string | null
          paid_at: string | null
          pdf_path: string | null
          pricing_sheet_id: string | null
          pricing_sheet_name: string | null
          sales_rep_id: string | null
          sales_rep_name: string | null
          sent_at: string | null
          shipping: number
          stage: Database["public"]["Enums"]["order_stage"] | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          tax_amount: number
          tax_rate: number
          total: number
          total_commission: number
          total_expenses: number
          total_true_cost: number
          updated_at: string
        }
        Insert: {
          amount_paid?: number
          balance_due?: number
          client_id?: string | null
          client_snapshot?: Json
          created_at?: string
          created_by?: string | null
          currency?: string
          discount?: number
          due_date?: string | null
          fees?: number
          fx_rate?: number
          gross_margin?: number
          gross_profit?: number
          id?: string
          invoice_number: string
          issue_date?: string | null
          net_profit?: number
          notes?: string | null
          paid_at?: string | null
          pdf_path?: string | null
          pricing_sheet_id?: string | null
          pricing_sheet_name?: string | null
          sales_rep_id?: string | null
          sales_rep_name?: string | null
          sent_at?: string | null
          shipping?: number
          stage?: Database["public"]["Enums"]["order_stage"] | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          total?: number
          total_commission?: number
          total_expenses?: number
          total_true_cost?: number
          updated_at?: string
        }
        Update: {
          amount_paid?: number
          balance_due?: number
          client_id?: string | null
          client_snapshot?: Json
          created_at?: string
          created_by?: string | null
          currency?: string
          discount?: number
          due_date?: string | null
          fees?: number
          fx_rate?: number
          gross_margin?: number
          gross_profit?: number
          id?: string
          invoice_number?: string
          issue_date?: string | null
          net_profit?: number
          notes?: string | null
          paid_at?: string | null
          pdf_path?: string | null
          pricing_sheet_id?: string | null
          pricing_sheet_name?: string | null
          sales_rep_id?: string | null
          sales_rep_name?: string | null
          sent_at?: string | null
          shipping?: number
          stage?: Database["public"]["Enums"]["order_stage"] | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          total?: number
          total_commission?: number
          total_expenses?: number
          total_true_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_profit_by_client"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "invoices_pricing_sheet_id_fkey"
            columns: ["pricing_sheet_id"]
            isOneToOne: false
            referencedRelation: "pricing_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_sales_rep_id_fkey"
            columns: ["sales_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_sales_rep_id_fkey"
            columns: ["sales_rep_id"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
        ]
      }
      manufacturer_cost_history: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          currency: string
          effective_date: string
          effective_to: string | null
          expiration_date: string | null
          id: string
          manufacturer_product_id: string
          max_quantity: number | null
          min_quantity: number
          previous_cost: number | null
          reason: string | null
          source: Database["public"]["Enums"]["cost_source"]
          source_import_batch: string | null
          unit_cost: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          currency?: string
          effective_date?: string
          effective_to?: string | null
          expiration_date?: string | null
          id?: string
          manufacturer_product_id: string
          max_quantity?: number | null
          min_quantity?: number
          previous_cost?: number | null
          reason?: string | null
          source?: Database["public"]["Enums"]["cost_source"]
          source_import_batch?: string | null
          unit_cost: number
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          currency?: string
          effective_date?: string
          effective_to?: string | null
          expiration_date?: string | null
          id?: string
          manufacturer_product_id?: string
          max_quantity?: number | null
          min_quantity?: number
          previous_cost?: number | null
          reason?: string | null
          source?: Database["public"]["Enums"]["cost_source"]
          source_import_batch?: string | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "manufacturer_cost_history_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturer_cost_history_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "manufacturer_cost_history_manufacturer_product_id_fkey"
            columns: ["manufacturer_product_id"]
            isOneToOne: false
            referencedRelation: "manufacturer_product_costs"
            referencedColumns: ["manufacturer_product_id"]
          },
          {
            foreignKeyName: "manufacturer_cost_history_manufacturer_product_id_fkey"
            columns: ["manufacturer_product_id"]
            isOneToOne: false
            referencedRelation: "manufacturer_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturer_cost_history_source_import_batch_fkey"
            columns: ["source_import_batch"]
            isOneToOne: false
            referencedRelation: "manufacturer_cost_import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturer_cost_import_batches: {
        Row: {
          committed_at: string | null
          costs_created: number
          costs_updated: number
          created_at: string
          error: string | null
          error_report_path: string | null
          file_type: string | null
          filename: string
          id: string
          manufacturer_id: string
          mode: string | null
          relationships_created: number
          row_count: number
          rows_skipped: number
          status: Database["public"]["Enums"]["import_status"]
          storage_path: string
          summary: Json
          tiers_changed: number
          uploaded_by: string | null
          worksheet: string | null
        }
        Insert: {
          committed_at?: string | null
          costs_created?: number
          costs_updated?: number
          created_at?: string
          error?: string | null
          error_report_path?: string | null
          file_type?: string | null
          filename: string
          id?: string
          manufacturer_id: string
          mode?: string | null
          relationships_created?: number
          row_count?: number
          rows_skipped?: number
          status?: Database["public"]["Enums"]["import_status"]
          storage_path: string
          summary?: Json
          tiers_changed?: number
          uploaded_by?: string | null
          worksheet?: string | null
        }
        Update: {
          committed_at?: string | null
          costs_created?: number
          costs_updated?: number
          created_at?: string
          error?: string | null
          error_report_path?: string | null
          file_type?: string | null
          filename?: string
          id?: string
          manufacturer_id?: string
          mode?: string | null
          relationships_created?: number
          row_count?: number
          rows_skipped?: number
          status?: Database["public"]["Enums"]["import_status"]
          storage_path?: string
          summary?: Json
          tiers_changed?: number
          uploaded_by?: string | null
          worksheet?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manufacturer_cost_import_batches_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "manufacturers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturer_cost_import_batches_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturer_cost_import_batches_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
        ]
      }
      manufacturer_cost_import_rows: {
        Row: {
          batch_id: string
          classification: string | null
          created_at: string
          id: string
          messages: Json
          raw: Json
          row_number: number | null
          sku: string | null
          status: string | null
        }
        Insert: {
          batch_id: string
          classification?: string | null
          created_at?: string
          id?: string
          messages?: Json
          raw?: Json
          row_number?: number | null
          sku?: string | null
          status?: string | null
        }
        Update: {
          batch_id?: string
          classification?: string | null
          created_at?: string
          id?: string
          messages?: Json
          raw?: Json
          row_number?: number | null
          sku?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manufacturer_cost_import_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "manufacturer_cost_import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturer_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          notes: string | null
          payment_date: string
          purchase_order_id: string
          reference: string | null
          type: Database["public"]["Enums"]["manufacturer_payment_type"]
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          payment_date?: string
          purchase_order_id: string
          reference?: string | null
          type?: Database["public"]["Enums"]["manufacturer_payment_type"]
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          notes?: string | null
          payment_date?: string
          purchase_order_id?: string
          reference?: string | null
          type?: Database["public"]["Enums"]["manufacturer_payment_type"]
        }
        Relationships: [
          {
            foreignKeyName: "manufacturer_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturer_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "manufacturer_payments_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturer_payments_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturer_products: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          currency: string
          current_unit_cost: number | null
          id: string
          lead_time_days: number | null
          manufacturer_description: string | null
          manufacturer_id: string
          manufacturer_sku: string | null
          moq: number | null
          notes: string | null
          order_multiple: number | null
          product_id: string
          source_import_batch: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          currency?: string
          current_unit_cost?: number | null
          id?: string
          lead_time_days?: number | null
          manufacturer_description?: string | null
          manufacturer_id: string
          manufacturer_sku?: string | null
          moq?: number | null
          notes?: string | null
          order_multiple?: number | null
          product_id: string
          source_import_batch?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          currency?: string
          current_unit_cost?: number | null
          id?: string
          lead_time_days?: number | null
          manufacturer_description?: string | null
          manufacturer_id?: string
          manufacturer_sku?: string | null
          moq?: number | null
          notes?: string | null
          order_multiple?: number | null
          product_id?: string
          source_import_batch?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manufacturer_products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturer_products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "manufacturer_products_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "manufacturers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturer_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturer_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturer_products_source_import_batch_fkey"
            columns: ["source_import_batch"]
            isOneToOne: false
            referencedRelation: "manufacturer_cost_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturer_products_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturer_products_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
        ]
      }
      manufacturers: {
        Row: {
          address: Json
          contact_name: string | null
          created_at: string
          created_by: string | null
          default_currency: string
          default_lead_time_days: number | null
          email: string | null
          id: string
          legal_name: string | null
          name: string
          normalized_name: string | null
          notes: string | null
          payment_terms: Database["public"]["Enums"]["payment_terms"] | null
          phone: string | null
          status: Database["public"]["Enums"]["product_status"]
          updated_at: string
        }
        Insert: {
          address?: Json
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          default_currency?: string
          default_lead_time_days?: number | null
          email?: string | null
          id?: string
          legal_name?: string | null
          name: string
          normalized_name?: string | null
          notes?: string | null
          payment_terms?: Database["public"]["Enums"]["payment_terms"] | null
          phone?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          updated_at?: string
        }
        Update: {
          address?: Json
          contact_name?: string | null
          created_at?: string
          created_by?: string | null
          default_currency?: string
          default_lead_time_days?: number | null
          email?: string | null
          id?: string
          legal_name?: string | null
          name?: string
          normalized_name?: string | null
          notes?: string | null
          payment_terms?: Database["public"]["Enums"]["payment_terms"] | null
          phone?: string | null
          status?: Database["public"]["Enums"]["product_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manufacturers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
        ]
      }
      order_expenses: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          incurred_on: string
          invoice_id: string
          note: string | null
          type: Database["public"]["Enums"]["order_expense_type"]
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          incurred_on?: string
          invoice_id: string
          note?: string | null
          type?: Database["public"]["Enums"]["order_expense_type"]
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          incurred_on?: string
          invoice_id?: string
          note?: string | null
          type?: Database["public"]["Enums"]["order_expense_type"]
        }
        Relationships: [
          {
            foreignKeyName: "order_expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_expenses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "order_expenses_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_expenses_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ar_aging"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_expenses_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_expenses_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_outstanding_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          invoice_id: string
          method: Database["public"]["Enums"]["payment_method"]
          note: string | null
          received_at: string
          reference: string | null
          voided: boolean
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id: string
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          received_at?: string
          reference?: string | null
          voided?: boolean
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          invoice_id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          note?: string | null
          received_at?: string
          reference?: string | null
          voided?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ar_aging"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_outstanding_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_import_batches: {
        Row: {
          committed_at: string | null
          created_at: string
          error: string | null
          error_report_path: string | null
          file_type: string | null
          filename: string
          id: string
          mode: string | null
          prices_created: number
          prices_updated: number
          pricing_sheet_id: string | null
          row_count: number
          rows_skipped: number
          status: Database["public"]["Enums"]["import_status"]
          storage_path: string
          summary: Json
          tiers_changed: number
          uploaded_by: string | null
          worksheet: string | null
        }
        Insert: {
          committed_at?: string | null
          created_at?: string
          error?: string | null
          error_report_path?: string | null
          file_type?: string | null
          filename: string
          id?: string
          mode?: string | null
          prices_created?: number
          prices_updated?: number
          pricing_sheet_id?: string | null
          row_count?: number
          rows_skipped?: number
          status?: Database["public"]["Enums"]["import_status"]
          storage_path: string
          summary?: Json
          tiers_changed?: number
          uploaded_by?: string | null
          worksheet?: string | null
        }
        Update: {
          committed_at?: string | null
          created_at?: string
          error?: string | null
          error_report_path?: string | null
          file_type?: string | null
          filename?: string
          id?: string
          mode?: string | null
          prices_created?: number
          prices_updated?: number
          pricing_sheet_id?: string | null
          row_count?: number
          rows_skipped?: number
          status?: Database["public"]["Enums"]["import_status"]
          storage_path?: string
          summary?: Json
          tiers_changed?: number
          uploaded_by?: string | null
          worksheet?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pricing_import_batches_pricing_sheet_id_fkey"
            columns: ["pricing_sheet_id"]
            isOneToOne: false
            referencedRelation: "pricing_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_import_batches_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_import_batches_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
        ]
      }
      pricing_import_rows: {
        Row: {
          batch_id: string
          classification: string | null
          created_at: string
          id: string
          messages: Json
          raw: Json
          row_number: number | null
          sku: string | null
          status: string | null
        }
        Insert: {
          batch_id: string
          classification?: string | null
          created_at?: string
          id?: string
          messages?: Json
          raw?: Json
          row_number?: number | null
          sku?: string | null
          status?: string | null
        }
        Update: {
          batch_id?: string
          classification?: string | null
          created_at?: string
          id?: string
          messages?: Json
          raw?: Json
          row_number?: number | null
          sku?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pricing_import_rows_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "pricing_import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_item_history: {
        Row: {
          changed_by: string | null
          created_at: string
          id: string
          new_price: number
          old_price: number | null
          pricing_sheet_id: string
          product_id: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          id?: string
          new_price: number
          old_price?: number | null
          pricing_sheet_id: string
          product_id: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          id?: string
          new_price?: number
          old_price?: number | null
          pricing_sheet_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_item_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_item_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "pricing_item_history_pricing_sheet_id_fkey"
            columns: ["pricing_sheet_id"]
            isOneToOne: false
            referencedRelation: "pricing_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_item_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_item_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_sheet_items: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          currency: string
          effective_date: string
          effective_to: string | null
          expiration_date: string | null
          id: string
          max_quantity: number | null
          min_quantity: number
          notes: string | null
          previous_price: number | null
          pricing_sheet_id: string
          product_id: string
          reason: string | null
          selling_price: number
          source_import_batch: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          currency?: string
          effective_date?: string
          effective_to?: string | null
          expiration_date?: string | null
          id?: string
          max_quantity?: number | null
          min_quantity?: number
          notes?: string | null
          previous_price?: number | null
          pricing_sheet_id: string
          product_id: string
          reason?: string | null
          selling_price: number
          source_import_batch?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          currency?: string
          effective_date?: string
          effective_to?: string | null
          expiration_date?: string | null
          id?: string
          max_quantity?: number | null
          min_quantity?: number
          notes?: string | null
          previous_price?: number | null
          pricing_sheet_id?: string
          product_id?: string
          reason?: string | null
          selling_price?: number
          source_import_batch?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pricing_sheet_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_sheet_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "pricing_sheet_items_pricing_sheet_id_fkey"
            columns: ["pricing_sheet_id"]
            isOneToOne: false
            referencedRelation: "pricing_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_sheet_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_sheet_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_sheet_items_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_sheet_items_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
        ]
      }
      pricing_sheets: {
        Row: {
          code: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          effective_date: string
          expiration_date: string | null
          id: string
          is_default: boolean
          name: string
          notes: string | null
          status: Database["public"]["Enums"]["sheet_status"]
          updated_at: string
          version: number
        }
        Insert: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          effective_date?: string
          expiration_date?: string | null
          id?: string
          is_default?: boolean
          name: string
          notes?: string | null
          status?: Database["public"]["Enums"]["sheet_status"]
          updated_at?: string
          version?: number
        }
        Update: {
          code?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          effective_date?: string
          expiration_date?: string | null
          id?: string
          is_default?: boolean
          name?: string
          notes?: string | null
          status?: Database["public"]["Enums"]["sheet_status"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "pricing_sheets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_sheets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
        ]
      }
      pricing_tiers: {
        Row: {
          created_at: string
          id: string
          max_qty: number | null
          min_qty: number
          pricing_sheet_item_id: string
          unit_price: number
        }
        Insert: {
          created_at?: string
          id?: string
          max_qty?: number | null
          min_qty: number
          pricing_sheet_item_id: string
          unit_price: number
        }
        Update: {
          created_at?: string
          id?: string
          max_qty?: number | null
          min_qty?: number
          pricing_sheet_item_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "pricing_tiers_pricing_sheet_item_id_fkey"
            columns: ["pricing_sheet_item_id"]
            isOneToOne: false
            referencedRelation: "pricing_item_margins"
            referencedColumns: ["item_id"]
          },
          {
            foreignKeyName: "pricing_tiers_pricing_sheet_item_id_fkey"
            columns: ["pricing_sheet_item_id"]
            isOneToOne: false
            referencedRelation: "pricing_sheet_items"
            referencedColumns: ["id"]
          },
        ]
      }
      product_cost_history: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          effective_date: string
          effective_to: string | null
          id: string
          import_batch_id: string | null
          note: string | null
          previous_cost: number | null
          product_id: string
          reason: string | null
          source: Database["public"]["Enums"]["cost_source"]
          true_cost: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          effective_date?: string
          effective_to?: string | null
          id?: string
          import_batch_id?: string | null
          note?: string | null
          previous_cost?: number | null
          product_id: string
          reason?: string | null
          source?: Database["public"]["Enums"]["cost_source"]
          true_cost: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          effective_date?: string
          effective_to?: string | null
          id?: string
          import_batch_id?: string | null
          note?: string | null
          previous_cost?: number | null
          product_id?: string
          reason?: string | null
          source?: Database["public"]["Enums"]["cost_source"]
          true_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "product_cost_history_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_cost_history_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "product_cost_history_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "catalog_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_cost_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_cost_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          currency: string
          current_true_cost: number
          description: string | null
          id: string
          lead_time_days: number | null
          manufacturer_id: string | null
          manufacturer_sku: string | null
          moq: number | null
          name: string
          notes: string | null
          pack_size: string | null
          preferred_manufacturer_id: string | null
          product_form: string | null
          sku: string
          status: Database["public"]["Enums"]["product_status"]
          strength: string | null
          unit_of_measure: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          current_true_cost?: number
          description?: string | null
          id?: string
          lead_time_days?: number | null
          manufacturer_id?: string | null
          manufacturer_sku?: string | null
          moq?: number | null
          name: string
          notes?: string | null
          pack_size?: string | null
          preferred_manufacturer_id?: string | null
          product_form?: string | null
          sku: string
          status?: Database["public"]["Enums"]["product_status"]
          strength?: string | null
          unit_of_measure?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          current_true_cost?: number
          description?: string | null
          id?: string
          lead_time_days?: number | null
          manufacturer_id?: string | null
          manufacturer_sku?: string | null
          moq?: number | null
          name?: string
          notes?: string | null
          pack_size?: string | null
          preferred_manufacturer_id?: string | null
          product_form?: string | null
          sku?: string
          status?: Database["public"]["Enums"]["product_status"]
          strength?: string | null
          unit_of_measure?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "products_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "manufacturers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_preferred_manufacturer_id_fkey"
            columns: ["preferred_manufacturer_id"]
            isOneToOne: false
            referencedRelation: "manufacturers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          default_commission_rate: number | null
          default_commission_type:
            | Database["public"]["Enums"]["commission_type"]
            | null
          email: string
          full_name: string
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["profile_status"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          default_commission_rate?: number | null
          default_commission_type?:
            | Database["public"]["Enums"]["commission_type"]
            | null
          email: string
          full_name?: string
          id: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["profile_status"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          default_commission_rate?: number | null
          default_commission_type?:
            | Database["public"]["Enums"]["commission_type"]
            | null
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["profile_status"]
          updated_at?: string
        }
        Relationships: []
      }
      purchase_order_attachments: {
        Row: {
          created_at: string
          file_type: string | null
          filename: string
          id: string
          note: string | null
          purchase_order_id: string
          size_bytes: number | null
          storage_path: string
          type: Database["public"]["Enums"]["po_attachment_type"]
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_type?: string | null
          filename: string
          id?: string
          note?: string | null
          purchase_order_id: string
          size_bytes?: number | null
          storage_path: string
          type?: Database["public"]["Enums"]["po_attachment_type"]
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_type?: string | null
          filename?: string
          id?: string
          note?: string | null
          purchase_order_id?: string
          size_bytes?: number | null
          storage_path?: string
          type?: Database["public"]["Enums"]["po_attachment_type"]
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_attachments_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_attachments_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
        ]
      }
      purchase_order_items: {
        Row: {
          cost_reason: string | null
          created_at: string
          created_by: string | null
          currency: string
          id: string
          lead_time_days: number | null
          line_total: number
          manufacturer_cost_history_id: string | null
          manufacturer_description: string | null
          manufacturer_id: string | null
          manufacturer_product_id: string | null
          manufacturer_sku: string | null
          moq: number | null
          name: string
          notes: string | null
          order_multiple: number | null
          pack_size: string | null
          product_id: string | null
          purchase_order_id: string
          quantity: number
          received_cost_logged: boolean
          resolved_cost_source: string | null
          resolved_tier_max: number | null
          resolved_tier_min: number | null
          sku: string
          strength: string | null
          unit_cost: number
        }
        Insert: {
          cost_reason?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          lead_time_days?: number | null
          line_total?: number
          manufacturer_cost_history_id?: string | null
          manufacturer_description?: string | null
          manufacturer_id?: string | null
          manufacturer_product_id?: string | null
          manufacturer_sku?: string | null
          moq?: number | null
          name: string
          notes?: string | null
          order_multiple?: number | null
          pack_size?: string | null
          product_id?: string | null
          purchase_order_id: string
          quantity: number
          received_cost_logged?: boolean
          resolved_cost_source?: string | null
          resolved_tier_max?: number | null
          resolved_tier_min?: number | null
          sku: string
          strength?: string | null
          unit_cost: number
        }
        Update: {
          cost_reason?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          id?: string
          lead_time_days?: number | null
          line_total?: number
          manufacturer_cost_history_id?: string | null
          manufacturer_description?: string | null
          manufacturer_id?: string | null
          manufacturer_product_id?: string | null
          manufacturer_sku?: string | null
          moq?: number | null
          name?: string
          notes?: string | null
          order_multiple?: number | null
          pack_size?: string | null
          product_id?: string | null
          purchase_order_id?: string
          quantity?: number
          received_cost_logged?: boolean
          resolved_cost_source?: string | null
          resolved_tier_max?: number | null
          resolved_tier_min?: number | null
          sku?: string
          strength?: string | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "purchase_order_items_manufacturer_cost_history_id_fkey"
            columns: ["manufacturer_cost_history_id"]
            isOneToOne: false
            referencedRelation: "manufacturer_cost_bands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_manufacturer_cost_history_id_fkey"
            columns: ["manufacturer_cost_history_id"]
            isOneToOne: false
            referencedRelation: "manufacturer_cost_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "manufacturers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_manufacturer_product_id_fkey"
            columns: ["manufacturer_product_id"]
            isOneToOne: false
            referencedRelation: "manufacturer_product_costs"
            referencedColumns: ["manufacturer_product_id"]
          },
          {
            foreignKeyName: "purchase_order_items_manufacturer_product_id_fkey"
            columns: ["manufacturer_product_id"]
            isOneToOne: false
            referencedRelation: "manufacturer_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_receipts: {
        Row: {
          created_at: string
          id: string
          lot_number: string | null
          notes: string | null
          purchase_order_id: string
          purchase_order_item_id: string
          quantity_received: number
          received_by: string | null
          received_date: string
          shipment_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          lot_number?: string | null
          notes?: string | null
          purchase_order_id: string
          purchase_order_item_id: string
          quantity_received: number
          received_by?: string | null
          received_date?: string
          shipment_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          lot_number?: string | null
          notes?: string | null
          purchase_order_id?: string
          purchase_order_item_id?: string
          quantity_received?: number
          received_by?: string | null
          received_date?: string
          shipment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_receipts_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_receipts_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_receipts_purchase_order_item_id_fkey"
            columns: ["purchase_order_item_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_receipts_purchase_order_item_id_fkey"
            columns: ["purchase_order_item_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_receipts_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_receipts_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "purchase_order_receipts_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "purchase_order_shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_shipments: {
        Row: {
          carrier: string | null
          created_at: string
          created_by: string | null
          expected_arrival_date: string | null
          id: string
          notes: string | null
          purchase_order_id: string
          received_date: string | null
          ship_date: string | null
          tracking_number: string | null
          updated_at: string
        }
        Insert: {
          carrier?: string | null
          created_at?: string
          created_by?: string | null
          expected_arrival_date?: string | null
          id?: string
          notes?: string | null
          purchase_order_id: string
          received_date?: string | null
          ship_date?: string | null
          tracking_number?: string | null
          updated_at?: string
        }
        Update: {
          carrier?: string | null
          created_at?: string
          created_by?: string | null
          expected_arrival_date?: string | null
          id?: string
          notes?: string | null
          purchase_order_id?: string
          received_date?: string | null
          ship_date?: string | null
          tracking_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_shipments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_shipments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "purchase_order_shipments_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_shipments_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_status_history: {
        Row: {
          changed_by: string | null
          created_at: string
          from_status: Database["public"]["Enums"]["po_status"] | null
          id: string
          note: string | null
          purchase_order_id: string
          to_status: Database["public"]["Enums"]["po_status"]
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["po_status"] | null
          id?: string
          note?: string | null
          purchase_order_id: string
          to_status: Database["public"]["Enums"]["po_status"]
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          from_status?: Database["public"]["Enums"]["po_status"] | null
          id?: string
          note?: string | null
          purchase_order_id?: string
          to_status?: Database["public"]["Enums"]["po_status"]
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_status_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "purchase_order_status_history_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_status_history_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          amount_paid: number
          balance_due: number
          confirmed_at: string | null
          created_at: string
          created_by: string | null
          currency: string
          deposit_amount: number
          expected_date: string | null
          fees: number
          fx_rate: number
          id: string
          manufacturer_id: string | null
          manufacturer_snapshot: Json
          notes: string | null
          payment_terms: string | null
          po_number: string
          received_at: string | null
          sent_at: string | null
          shipping: number
          status: Database["public"]["Enums"]["po_status"]
          subtotal: number
          tax: number
          total: number
          updated_at: string
        }
        Insert: {
          amount_paid?: number
          balance_due?: number
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deposit_amount?: number
          expected_date?: string | null
          fees?: number
          fx_rate?: number
          id?: string
          manufacturer_id?: string | null
          manufacturer_snapshot?: Json
          notes?: string | null
          payment_terms?: string | null
          po_number: string
          received_at?: string | null
          sent_at?: string | null
          shipping?: number
          status?: Database["public"]["Enums"]["po_status"]
          subtotal?: number
          tax?: number
          total?: number
          updated_at?: string
        }
        Update: {
          amount_paid?: number
          balance_due?: number
          confirmed_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deposit_amount?: number
          expected_date?: string | null
          fees?: number
          fx_rate?: number
          id?: string
          manufacturer_id?: string | null
          manufacturer_snapshot?: Json
          notes?: string | null
          payment_terms?: string | null
          po_number?: string
          received_at?: string | null
          sent_at?: string | null
          shipping?: number
          status?: Database["public"]["Enums"]["po_status"]
          subtotal?: number
          tax?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "purchase_orders_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "manufacturers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      catalog_products: {
        Row: {
          can_see_cost: boolean | null
          category: string | null
          created_at: string | null
          currency: string | null
          description: string | null
          id: string | null
          lead_time_days: number | null
          manufacturer_id: string | null
          manufacturer_name: string | null
          manufacturer_sku: string | null
          moq: number | null
          name: string | null
          notes: string | null
          pack_size: string | null
          product_form: string | null
          sku: string | null
          status: Database["public"]["Enums"]["product_status"] | null
          strength: string | null
          true_cost: number | null
          unit_of_measure: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "manufacturers"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturer_cost_bands: {
        Row: {
          created_at: string | null
          currency: string | null
          effective_date: string | null
          expiration_date: string | null
          id: string | null
          manufacturer_id: string | null
          manufacturer_product_id: string | null
          max_quantity: number | null
          min_quantity: number | null
          previous_cost: number | null
          product_id: string | null
          product_name: string | null
          reason: string | null
          sku: string | null
          source: Database["public"]["Enums"]["cost_source"] | null
          unit_cost: number | null
        }
        Relationships: [
          {
            foreignKeyName: "manufacturer_cost_history_manufacturer_product_id_fkey"
            columns: ["manufacturer_product_id"]
            isOneToOne: false
            referencedRelation: "manufacturer_product_costs"
            referencedColumns: ["manufacturer_product_id"]
          },
          {
            foreignKeyName: "manufacturer_cost_history_manufacturer_product_id_fkey"
            columns: ["manufacturer_product_id"]
            isOneToOne: false
            referencedRelation: "manufacturer_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturer_products_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "manufacturers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturer_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturer_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturer_product_costs: {
        Row: {
          active: boolean | null
          active_band_count: number | null
          base_unit_cost: number | null
          cost_effective_date: string | null
          cost_expiration_date: string | null
          created_at: string | null
          currency: string | null
          current_unit_cost: number | null
          is_preferred: boolean | null
          last_cost_update: string | null
          lead_time_days: number | null
          manufacturer_description: string | null
          manufacturer_id: string | null
          manufacturer_name: string | null
          manufacturer_product_id: string | null
          manufacturer_sku: string | null
          manufacturer_status:
            | Database["public"]["Enums"]["product_status"]
            | null
          moq: number | null
          notes: string | null
          order_multiple: number | null
          product_id: string | null
          product_name: string | null
          product_status: Database["public"]["Enums"]["product_status"] | null
          sku: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manufacturer_products_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "manufacturers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturer_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturer_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_item_margins: {
        Row: {
          below_cost: boolean | null
          currency: string | null
          effective_date: string | null
          item_id: string | null
          margin_amount: number | null
          margin_pct: number | null
          max_quantity: number | null
          min_quantity: number | null
          name: string | null
          pack_size: string | null
          pricing_sheet_id: string | null
          product_id: string | null
          selling_price: number | null
          sku: string | null
          strength: string | null
          true_cost: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pricing_sheet_items_pricing_sheet_id_fkey"
            columns: ["pricing_sheet_id"]
            isOneToOne: false
            referencedRelation: "pricing_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_sheet_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_sheet_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      v_ar_aging: {
        Row: {
          aging_bucket: string | null
          amount_paid: number | null
          balance_due: number | null
          client_id: string | null
          company_name: string | null
          currency: string | null
          days_overdue: number | null
          due_date: string | null
          id: string | null
          invoice_number: string | null
          issue_date: string | null
          sales_rep_id: string | null
          sales_rep_name: string | null
          status: Database["public"]["Enums"]["invoice_status"] | null
          total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_profit_by_client"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "invoices_sales_rep_id_fkey"
            columns: ["sales_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_sales_rep_id_fkey"
            columns: ["sales_rep_id"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
        ]
      }
      v_ar_summary: {
        Row: {
          current_amt: number | null
          d1_30: number | null
          d31_60: number | null
          d61_90: number | null
          d90_plus: number | null
          invoice_count: number | null
          overdue_amt: number | null
          total_outstanding: number | null
        }
        Relationships: []
      }
      v_commission_by_rep: {
        Row: {
          owed: number | null
          paid: number | null
          recipient_id: string | null
          recipient_name: string | null
          total: number | null
        }
        Relationships: []
      }
      v_commission_summary: {
        Row: {
          active_count: number | null
          approved: number | null
          earned: number | null
          owed: number | null
          paid: number | null
          pending: number | null
        }
        Relationships: []
      }
      v_commissions: {
        Row: {
          amount: number | null
          approved_at: string | null
          approved_by: string | null
          basis_amount: number | null
          can_see_internal: boolean | null
          client_id: string | null
          commission_type: Database["public"]["Enums"]["commission_type"] | null
          company_name: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          invoice_due_date: string | null
          invoice_gross_profit: number | null
          invoice_id: string | null
          invoice_issue_date: string | null
          invoice_number: string | null
          invoice_paid_at: string | null
          invoice_rep_id: string | null
          invoice_rep_name: string | null
          invoice_status: Database["public"]["Enums"]["invoice_status"] | null
          invoice_subtotal: number | null
          note: string | null
          paid_at: string | null
          paid_by: string | null
          paid_method: Database["public"]["Enums"]["payment_method"] | null
          paid_note: string | null
          paid_reference: string | null
          payment_notes: string | null
          rate: number | null
          recipient_company: string | null
          recipient_email: string | null
          recipient_id: string | null
          recipient_name: string | null
          recipient_type:
            | Database["public"]["Enums"]["commission_recipient_type"]
            | null
          status: Database["public"]["Enums"]["commission_status"] | null
          units: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commissions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "commissions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "commissions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ar_aging"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_outstanding_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_paid_by_fkey"
            columns: ["paid_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "commissions_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_profit_by_client"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "invoices_sales_rep_id_fkey"
            columns: ["invoice_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_sales_rep_id_fkey"
            columns: ["invoice_rep_id"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
        ]
      }
      v_manufacturer_payments: {
        Row: {
          amount: number | null
          created_at: string | null
          created_by: string | null
          id: string | null
          manufacturer_id: string | null
          manufacturer_name: string | null
          method: Database["public"]["Enums"]["payment_method"] | null
          notes: string | null
          payment_date: string | null
          po_number: string | null
          purchase_order_id: string | null
          reference: string | null
          signed_amount: number | null
          type: Database["public"]["Enums"]["manufacturer_payment_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "manufacturer_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturer_payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "manufacturer_payments_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturer_payments_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "manufacturers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_order_items: {
        Row: {
          created_at: string | null
          expiration_date: string | null
          id: string | null
          invoice_id: string | null
          line_gross_profit: number | null
          line_subtotal: number | null
          line_true_cost: number | null
          lot_number: string | null
          manual_reason: string | null
          manufacturer_name: string | null
          manufacturing_date: string | null
          original_unit_price: number | null
          pack_size: string | null
          price_overridden: boolean | null
          price_source: string | null
          price_source_sheet: string | null
          product_id: string | null
          product_name: string | null
          quantity: number | null
          retest_date: string | null
          sku: string | null
          strength: string | null
          unit_price: number | null
          unit_true_cost: number | null
        }
        Insert: {
          created_at?: string | null
          expiration_date?: string | null
          id?: string | null
          invoice_id?: string | null
          line_gross_profit?: never
          line_subtotal?: number | null
          line_true_cost?: never
          lot_number?: string | null
          manual_reason?: string | null
          manufacturer_name?: string | null
          manufacturing_date?: string | null
          original_unit_price?: number | null
          pack_size?: string | null
          price_overridden?: boolean | null
          price_source?: string | null
          price_source_sheet?: string | null
          product_id?: string | null
          product_name?: string | null
          quantity?: number | null
          retest_date?: string | null
          sku?: string | null
          strength?: string | null
          unit_price?: number | null
          unit_true_cost?: never
        }
        Update: {
          created_at?: string | null
          expiration_date?: string | null
          id?: string | null
          invoice_id?: string | null
          line_gross_profit?: never
          line_subtotal?: number | null
          line_true_cost?: never
          lot_number?: string | null
          manual_reason?: string | null
          manufacturer_name?: string | null
          manufacturing_date?: string | null
          original_unit_price?: number | null
          pack_size?: string | null
          price_overridden?: boolean | null
          price_source?: string | null
          price_source_sheet?: string | null
          product_id?: string | null
          product_name?: string | null
          quantity?: number | null
          retest_date?: string | null
          sku?: string | null
          strength?: string | null
          unit_price?: number | null
          unit_true_cost?: never
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ar_aging"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_outstanding_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      v_orders: {
        Row: {
          amount_paid: number | null
          balance_due: number | null
          can_see_internal: boolean | null
          client_id: string | null
          client_snapshot: Json | null
          company_name: string | null
          created_at: string | null
          currency: string | null
          discount: number | null
          due_date: string | null
          fees: number | null
          gross_margin: number | null
          gross_profit: number | null
          id: string | null
          invoice_number: string | null
          issue_date: string | null
          net_profit: number | null
          notes: string | null
          paid_at: string | null
          pricing_sheet_id: string | null
          pricing_sheet_name: string | null
          sales_rep_id: string | null
          sales_rep_name: string | null
          sent_at: string | null
          shipping: number | null
          stage: Database["public"]["Enums"]["order_stage"] | null
          status: Database["public"]["Enums"]["invoice_status"] | null
          subtotal: number | null
          tax_amount: number | null
          tax_rate: number | null
          total: number | null
          total_commission: number | null
          total_expenses: number | null
          total_true_cost: number | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_profit_by_client"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "invoices_pricing_sheet_id_fkey"
            columns: ["pricing_sheet_id"]
            isOneToOne: false
            referencedRelation: "pricing_sheets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_sales_rep_id_fkey"
            columns: ["sales_rep_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_sales_rep_id_fkey"
            columns: ["sales_rep_id"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
        ]
      }
      v_outstanding_invoices: {
        Row: {
          amount_paid: number | null
          balance_due: number | null
          client_id: string | null
          due_date: string | null
          id: string | null
          invoice_number: string | null
          status: Database["public"]["Enums"]["invoice_status"] | null
          total: number | null
        }
        Insert: {
          amount_paid?: number | null
          balance_due?: number | null
          client_id?: string | null
          due_date?: string | null
          id?: string | null
          invoice_number?: string | null
          status?: Database["public"]["Enums"]["invoice_status"] | null
          total?: number | null
        }
        Update: {
          amount_paid?: number | null
          balance_due?: number | null
          client_id?: string | null
          due_date?: string | null
          id?: string | null
          invoice_number?: string | null
          status?: Database["public"]["Enums"]["invoice_status"] | null
          total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_profit_by_client"
            referencedColumns: ["client_id"]
          },
        ]
      }
      v_profit_by_client: {
        Row: {
          client_id: string | null
          company_name: string | null
          gross_profit: number | null
          invoices: number | null
          net_profit: number | null
          revenue: number | null
        }
        Relationships: []
      }
      v_profit_by_product: {
        Row: {
          gross_profit: number | null
          product_id: string | null
          product_name: string | null
          revenue: number | null
          sku: string | null
          units_sold: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      v_profit_by_rep: {
        Row: {
          full_name: string | null
          gross_profit: number | null
          invoices: number | null
          net_profit: number | null
          rep_id: string | null
          revenue: number | null
        }
        Relationships: []
      }
      v_purchase_order_items: {
        Row: {
          cost_reason: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          description: string | null
          id: string | null
          lead_time_days: number | null
          line_total: number | null
          manufacturer_cost_history_id: string | null
          manufacturer_description: string | null
          manufacturer_id: string | null
          manufacturer_product_id: string | null
          manufacturer_sku: string | null
          moq: number | null
          notes: string | null
          order_multiple: number | null
          pack_size: string | null
          product_id: string | null
          product_name: string | null
          purchase_order_id: string | null
          quantity: number | null
          quantity_received: number | null
          received_cost_logged: boolean | null
          resolved_cost_source: string | null
          resolved_tier_max: number | null
          resolved_tier_min: number | null
          sku: string | null
          strength: string | null
          unit_cost: number | null
        }
        Insert: {
          cost_reason?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          description?: never
          id?: string | null
          lead_time_days?: number | null
          line_total?: number | null
          manufacturer_cost_history_id?: string | null
          manufacturer_description?: string | null
          manufacturer_id?: string | null
          manufacturer_product_id?: string | null
          manufacturer_sku?: string | null
          moq?: number | null
          notes?: string | null
          order_multiple?: number | null
          pack_size?: string | null
          product_id?: string | null
          product_name?: string | null
          purchase_order_id?: string | null
          quantity?: number | null
          quantity_received?: never
          received_cost_logged?: boolean | null
          resolved_cost_source?: string | null
          resolved_tier_max?: number | null
          resolved_tier_min?: number | null
          sku?: string | null
          strength?: string | null
          unit_cost?: number | null
        }
        Update: {
          cost_reason?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          description?: never
          id?: string | null
          lead_time_days?: number | null
          line_total?: number | null
          manufacturer_cost_history_id?: string | null
          manufacturer_description?: string | null
          manufacturer_id?: string | null
          manufacturer_product_id?: string | null
          manufacturer_sku?: string | null
          moq?: number | null
          notes?: string | null
          order_multiple?: number | null
          pack_size?: string | null
          product_id?: string | null
          product_name?: string | null
          purchase_order_id?: string | null
          quantity?: number | null
          quantity_received?: never
          received_cost_logged?: boolean | null
          resolved_cost_source?: string | null
          resolved_tier_max?: number | null
          resolved_tier_min?: number | null
          sku?: string | null
          strength?: string | null
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "purchase_order_items_manufacturer_cost_history_id_fkey"
            columns: ["manufacturer_cost_history_id"]
            isOneToOne: false
            referencedRelation: "manufacturer_cost_bands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_manufacturer_cost_history_id_fkey"
            columns: ["manufacturer_cost_history_id"]
            isOneToOne: false
            referencedRelation: "manufacturer_cost_history"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "manufacturers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_manufacturer_product_id_fkey"
            columns: ["manufacturer_product_id"]
            isOneToOne: false
            referencedRelation: "manufacturer_product_costs"
            referencedColumns: ["manufacturer_product_id"]
          },
          {
            foreignKeyName: "purchase_order_items_manufacturer_product_id_fkey"
            columns: ["manufacturer_product_id"]
            isOneToOne: false
            referencedRelation: "manufacturer_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "catalog_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "v_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      v_purchase_orders: {
        Row: {
          amount_paid: number | null
          balance_due: number | null
          confirmed_at: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          deposit_amount: number | null
          expected_date: string | null
          fees: number | null
          id: string | null
          line_count: number | null
          manufacturer_id: string | null
          manufacturer_name: string | null
          manufacturer_status:
            | Database["public"]["Enums"]["product_status"]
            | null
          next_expected_arrival: string | null
          notes: string | null
          payment_terms: string | null
          po_number: string | null
          received_at: string | null
          sent_at: string | null
          shipping: number | null
          status: Database["public"]["Enums"]["po_status"] | null
          subtotal: number | null
          tax: number | null
          total: number | null
          total_quantity: number | null
          tracking_numbers: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_profit_by_rep"
            referencedColumns: ["rep_id"]
          },
          {
            foreignKeyName: "purchase_orders_manufacturer_id_fkey"
            columns: ["manufacturer_id"]
            isOneToOne: false
            referencedRelation: "manufacturers"
            referencedColumns: ["id"]
          },
        ]
      }
      v_purchase_spend_monthly: {
        Row: {
          month: string | null
          po_count: number | null
          spend: number | null
        }
        Relationships: []
      }
      v_revenue_monthly: {
        Row: {
          gross_profit: number | null
          invoice_count: number | null
          month: string | null
          net_profit: number | null
          revenue: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_order_expense: {
        Args: {
          p_amount: number
          p_incurred_on: string
          p_invoice: string
          p_note: string
          p_type: string
        }
        Returns: string
      }
      add_po_attachment: {
        Args: {
          p_file_type: string
          p_filename: string
          p_note: string
          p_po: string
          p_size: number
          p_storage_path: string
          p_type: string
        }
        Returns: string
      }
      add_po_shipment: {
        Args: {
          p_carrier: string
          p_expected_arrival: string
          p_notes: string
          p_po: string
          p_received_date: string
          p_ship_date: string
          p_tracking: string
        }
        Returns: string
      }
      approve_commission: { Args: { p_commission: string }; Returns: undefined }
      assign_invoice_lot: {
        Args: {
          p_coa_path: string
          p_expiration_date: string
          p_item: string
          p_lot: string
          p_manufacturing_date: string
          p_retest_date: string
        }
        Returns: undefined
      }
      assign_pricing_model: {
        Args: {
          p_client: string
          p_effective: string
          p_expiration: string
          p_notes: string
          p_sheet: string
        }
        Returns: undefined
      }
      bulk_adjust_prices: {
        Args: {
          p_product_ids: Json
          p_reason: string
          p_sheet: string
          p_type: string
          p_value: number
        }
        Returns: Json
      }
      bulk_approve_commissions: { Args: { p_ids: string[] }; Returns: Json }
      bulk_pay_commissions: {
        Args: {
          p_ids: string[]
          p_method: string
          p_note: string
          p_reference: string
        }
        Returns: Json
      }
      create_commission: {
        Args: {
          p_commission_type: string
          p_invoice: string
          p_note: string
          p_payment_notes: string
          p_rate: number
          p_recipient_company: string
          p_recipient_email: string
          p_recipient_id: string
          p_recipient_name: string
          p_recipient_type: string
          p_units: number
        }
        Returns: string
      }
      delete_draft: { Args: { p_invoice: string }; Returns: undefined }
      delete_order_expense: { Args: { p_expense: string }; Returns: undefined }
      delete_po_draft: { Args: { p_po: string }; Returns: undefined }
      duplicate_pricing_model: {
        Args: { p_code: string; p_name: string; p_sheet: string }
        Returns: string
      }
      import_catalog: {
        Args: { p_batch: string; p_mode: string; p_rows: Json }
        Returns: Json
      }
      import_manufacturer_costs: {
        Args: {
          p_batch: string
          p_manufacturer: string
          p_mode: string
          p_rows: Json
        }
        Returns: Json
      }
      import_pricing: {
        Args: { p_batch: string; p_mode: string; p_rows: Json; p_sheet: string }
        Returns: Json
      }
      issue_invoice: {
        Args: { p_due_date: string; p_invoice: string; p_issue_date: string }
        Returns: string
      }
      pay_commission: {
        Args: {
          p_commission: string
          p_method: string
          p_note: string
          p_paid_at: string
          p_reference: string
        }
        Returns: undefined
      }
      preview_commission: {
        Args: {
          p_commission_type: string
          p_invoice: string
          p_rate: number
          p_units: number
        }
        Returns: Json
      }
      promote_manufacturer_cost: {
        Args: {
          p_effective?: string
          p_manufacturer: string
          p_product: string
          p_reason: string
          p_set_preferred?: boolean
        }
        Returns: Json
      }
      receive_po_line: {
        Args: {
          p_item: string
          p_lot: string
          p_notes: string
          p_quantity: number
          p_received_date: string
          p_shipment: string
        }
        Returns: string
      }
      record_manufacturer_payment: {
        Args: {
          p_amount: number
          p_date: string
          p_method: string
          p_notes: string
          p_po: string
          p_reference: string
          p_type: string
        }
        Returns: string
      }
      record_payment: {
        Args: {
          p_amount: number
          p_invoice: string
          p_method: string
          p_note: string
          p_received_at: string
          p_reference: string
        }
        Returns: string
      }
      record_product_cost: {
        Args: {
          p_currency: string
          p_new_cost: number
          p_product: string
          p_reason: string
        }
        Returns: string
      }
      resolve_manufacturer_cost: {
        Args: {
          p_currency?: string
          p_effective?: string
          p_manufacturer: string
          p_product: string
          p_quantity?: number
        }
        Returns: Json
      }
      resolve_price: {
        Args: {
          p_client_id: string
          p_currency?: string
          p_effective?: string
          p_manual_price?: number
          p_manual_reason?: string
          p_product_id: string
          p_quantity?: number
          p_selected_model?: string
        }
        Returns: Json
      }
      save_order_draft: {
        Args: {
          p_client: string
          p_currency: string
          p_discount: number
          p_fees: number
          p_invoice: string
          p_lines: Json
          p_notes: string
          p_selected_model: string
          p_shipping: number
          p_tax_rate: number
        }
        Returns: string
      }
      save_po_draft: {
        Args: {
          p_currency: string
          p_expected_date: string
          p_fees: number
          p_lines: Json
          p_manufacturer: string
          p_notes: string
          p_payment_terms: string
          p_po: string
          p_shipping: number
          p_tax: number
        }
        Returns: string
      }
      send_po: { Args: { p_po: string }; Returns: string }
      set_client_override: {
        Args: {
          p_active: boolean
          p_client: string
          p_currency: string
          p_effective: string
          p_expiration: string
          p_max_qty: number
          p_min_qty: number
          p_notes: string
          p_price: number
          p_product: string
          p_reason: string
        }
        Returns: string
      }
      set_manufacturer_cost: {
        Args: {
          p_active: boolean
          p_cost: number
          p_currency: string
          p_effective: string
          p_expiration: string
          p_max_qty: number
          p_min_qty: number
          p_reason: string
          p_relationship: string
        }
        Returns: string
      }
      set_product_price: {
        Args: {
          p_active: boolean
          p_currency: string
          p_effective: string
          p_expiration: string
          p_max_qty: number
          p_min_qty: number
          p_notes: string
          p_price: number
          p_product: string
          p_reason: string
          p_sheet: string
        }
        Returns: string
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      transition_po_status: {
        Args: { p_note: string; p_po: string; p_to: string }
        Returns: undefined
      }
      update_commission: {
        Args: {
          p_commission: string
          p_commission_type: string
          p_note: string
          p_payment_notes: string
          p_rate: number
          p_recipient_company: string
          p_recipient_email: string
          p_recipient_id: string
          p_recipient_name: string
          p_recipient_type: string
          p_units: number
        }
        Returns: undefined
      }
      upsert_manufacturer_product: {
        Args: {
          p_active: boolean
          p_currency: string
          p_description: string
          p_lead_time: number
          p_manufacturer: string
          p_manufacturer_sku: string
          p_moq: number
          p_notes: string
          p_order_multiple: number
          p_product: string
        }
        Returns: string
      }
      void_commission: {
        Args: { p_commission: string; p_reason: string }
        Returns: undefined
      }
      void_invoice: {
        Args: { p_invoice: string; p_reason: string }
        Returns: undefined
      }
      void_po: { Args: { p_po: string; p_reason: string }; Returns: undefined }
    }
    Enums: {
      client_status: "active" | "inactive" | "prospect"
      commission_recipient_type: "internal_user" | "external_partner"
      commission_status: "pending" | "approved" | "paid" | "void" | "earned"
      commission_type:
        | "percent_of_sale"
        | "percent_of_gross_profit"
        | "flat"
        | "per_unit"
      cost_source: "manual" | "import" | "purchase_order"
      import_status: "pending" | "previewed" | "committed" | "failed"
      invoice_status: "draft" | "sent" | "paid" | "partial" | "void"
      manufacturer_payment_type:
        | "deposit"
        | "balance"
        | "additional"
        | "refund_credit"
      order_expense_type:
        | "payment_processing_fee"
        | "outbound_shipping"
        | "packaging"
        | "testing"
        | "referral_expense"
        | "other"
      order_stage:
        | "quote"
        | "approved_order"
        | "invoice"
        | "paid"
        | "fulfilled"
        | "complete"
      payment_method: "cash" | "check" | "wire" | "card" | "ach" | "other"
      payment_terms:
        | "due_on_receipt"
        | "net_15"
        | "net_30"
        | "net_45"
        | "net_60"
        | "custom"
      po_attachment_type:
        | "manufacturer_invoice"
        | "coa"
        | "packing_list"
        | "tracking"
        | "other"
        | "testing_document"
        | "shipping_document"
      po_status:
        | "draft"
        | "sent"
        | "confirmed"
        | "deposit_paid"
        | "production"
        | "testing"
        | "ready_to_ship"
        | "shipped"
        | "received"
        | "closed"
        | "void"
      product_status: "active" | "discontinued"
      profile_status: "active" | "inactive"
      sheet_status: "active" | "archived"
      user_role: "owner" | "admin" | "sales_rep"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      client_status: ["active", "inactive", "prospect"],
      commission_recipient_type: ["internal_user", "external_partner"],
      commission_status: ["pending", "approved", "paid", "void", "earned"],
      commission_type: [
        "percent_of_sale",
        "percent_of_gross_profit",
        "flat",
        "per_unit",
      ],
      cost_source: ["manual", "import", "purchase_order"],
      import_status: ["pending", "previewed", "committed", "failed"],
      invoice_status: ["draft", "sent", "paid", "partial", "void"],
      manufacturer_payment_type: [
        "deposit",
        "balance",
        "additional",
        "refund_credit",
      ],
      order_expense_type: [
        "payment_processing_fee",
        "outbound_shipping",
        "packaging",
        "testing",
        "referral_expense",
        "other",
      ],
      order_stage: [
        "quote",
        "approved_order",
        "invoice",
        "paid",
        "fulfilled",
        "complete",
      ],
      payment_method: ["cash", "check", "wire", "card", "ach", "other"],
      payment_terms: [
        "due_on_receipt",
        "net_15",
        "net_30",
        "net_45",
        "net_60",
        "custom",
      ],
      po_attachment_type: [
        "manufacturer_invoice",
        "coa",
        "packing_list",
        "tracking",
        "other",
        "testing_document",
        "shipping_document",
      ],
      po_status: [
        "draft",
        "sent",
        "confirmed",
        "deposit_paid",
        "production",
        "testing",
        "ready_to_ship",
        "shipped",
        "received",
        "closed",
        "void",
      ],
      product_status: ["active", "discontinued"],
      profile_status: ["active", "inactive"],
      sheet_status: ["active", "archived"],
      user_role: ["owner", "admin", "sales_rep"],
    },
  },
} as const
