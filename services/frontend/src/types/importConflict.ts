/**
 * Tipos para conflitos de importação.
 *
 * Quando um registro existente tem diferenças em tag/subtag ou valor,
 * um conflito é criado para que o usuário possa decidir se aceita ou rejeita as mudanças.
 */

export interface TagConflict {
  original_subtag_id: number | null;
  original_subtag_name: string | null;
  original_tag_name: string | null;
  new_subtag_id: number | null;
  new_subtag_name: string | null;
  new_tag_name: string | null;
}

export interface AmountConflict {
  original_amount: number;
  new_amount: number;
}

/**
 * Representa um registro candidato quando múltiplos matches são encontrados.
 *
 * Quando a chave (date sem segundos, description) retorna múltiplos registros,
 * cada um é listado para o usuário escolher qual atualizar.
 */
export interface MatchCandidate {
  id: number;
  amount: number;
  subtag_id: number | null;
  subtag_name: string | null;
  tag_name: string | null;
  // Campos específicos de faturas de cartão de crédito
  current_installment?: number | null;
  total_installments?: number | null;
}

export interface ImportConflict {
  // existing_id pode ser null quando há múltiplos matches
  existing_id: number | null;
  record_type: 'bank_statement' | 'credit_card_invoice' | 'benefit_statement';
  date: string;
  description: string;
  year_month?: string;
  card_number?: string;
  new_subtag_id?: number | null;
  new_amount?: number;

  // Arquivo de origem (para agrupar conflitos no modal)
  source_file?: string;

  // Conflitos (presentes apenas se houver diferença)
  tag_conflict?: TagConflict;
  amount_conflict?: AmountConflict;

  // Múltiplos matches - quando a chave retorna mais de um registro
  // e nenhum tem o mesmo valor do arquivo
  multiple_matches?: MatchCandidate[];
  selected_match_id?: number | null;
}

export interface ConflictResolution {
  existing_id: number;
  record_type: 'bank_statement' | 'credit_card_invoice' | 'benefit_statement';
  accept_tag_change: boolean;
  accept_amount_change: boolean;
  new_subtag_id?: number | null;
  new_amount?: number | null;

  // Para múltiplos matches - qual registro foi selecionado
  selected_from_multiple?: boolean;
}

export interface ConflictResolutionRequest {
  resolutions: ConflictResolution[];
}

export interface ImportResultWithConflicts {
  success: boolean;
  created: number;
  duplicates: number;
  skipped: number;
  unmapped: number;
  unmapped_records?: Array<Record<string, unknown>>;
  errors?: string[];
  conflicts?: ImportConflict[];
  conflicts_count?: number;
}

