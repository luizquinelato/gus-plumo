import type { CadastroImportModalConfig } from '../components/CadastroImportModal'
import {
  parseCartoesWorkbook,
  parseCompartilhamentosWorkbook,
  parseContasWorkbook,
  parseTagsSubtagsWorkbook,
  parseTemplatesWorkbook,
} from '../utils/parseCadastroImportWorkbook'

const masterSubtitlePreview =
  'Cadastros mestre: alterações não recalculam lançamentos nem fechamentos automaticamente.'

export const CADASTRO_IMPORT_TAGS: CadastroImportModalConfig = {
  title: 'Importar tags e subtags',
  subtitleFile: 'Use o Excel exportado nesta tela (abas Tags e Subtags).',
  subtitlePreview: masterSubtitlePreview,
  apiPath: '/api/cadastro-import/tags-subtags',
  parseFile: parseTagsSubtagsWorkbook,
}

export const CADASTRO_IMPORT_TEMPLATES: CadastroImportModalConfig = {
  title: 'Importar templates',
  subtitleFile: 'Use o Excel exportado nesta tela (Templates e Itens).',
  subtitlePreview: masterSubtitlePreview,
  apiPath: '/api/cadastro-import/templates',
  parseFile: parseTemplatesWorkbook,
}

export const CADASTRO_IMPORT_CONTAS: CadastroImportModalConfig = {
  title: 'Importar contas',
  subtitleFile: 'Use o Excel exportado nesta tela. Senhas de importação não entram na planilha.',
  subtitlePreview: masterSubtitlePreview,
  apiPath: '/api/cadastro-import/contas',
  parseFile: parseContasWorkbook,
}

export const CADASTRO_IMPORT_COMPARTILHAMENTOS: CadastroImportModalConfig = {
  title: 'Importar compartilhamentos',
  subtitleFile: 'Exporta apenas vínculos diretos da conta selecionada.',
  subtitlePreview: masterSubtitlePreview,
  apiPath: '/api/cadastro-import/compartilhamentos',
  parseFile: parseCompartilhamentosWorkbook,
}

export const CADASTRO_IMPORT_CARTOES: CadastroImportModalConfig = {
  title: 'Importar cartões',
  subtitleFile: 'Abas Grupos e Cartões, no formato do export.',
  subtitlePreview: masterSubtitlePreview,
  apiPath: '/api/cadastro-import/cartoes',
  parseFile: parseCartoesWorkbook,
}
