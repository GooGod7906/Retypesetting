import { create } from 'zustand';
import { FormatTemplate } from '../types/template';
import * as templateApi from '../services/template';

interface TemplateStore {
  templates: FormatTemplate[];
  selectedTemplateId: string | null;
  editingTemplateId: string | null;
  loading: boolean;
  error: string | null;

  fetchTemplates: () => Promise<void>;
  selectTemplate: (id: string) => void;
  getSelectedTemplate: () => FormatTemplate | undefined;

  createTemplate: (template: Omit<FormatTemplate, 'id'>) => Promise<FormatTemplate>;
  updateTemplate: (id: string, updates: Partial<FormatTemplate>) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  exportTemplate: (id: string) => Promise<void>;

  startEditing: (id: string) => void;
  stopEditing: () => void;
}

export const useTemplateStore = create<TemplateStore>((set, get) => ({
  templates: [],
  selectedTemplateId: null,
  editingTemplateId: null,
  loading: false,
  error: null,

  fetchTemplates: async () => {
    set({ loading: true, error: null });
    try {
      const templates = await templateApi.getAllTemplates();
      set({
        templates,
        loading: false,
        selectedTemplateId: get().selectedTemplateId || templates[0]?.id || null,
      });
    } catch {
      set({ error: '加载模板失败', loading: false });
    }
  },

  selectTemplate: (id) =>
    set({ selectedTemplateId: id }),

  getSelectedTemplate: () => {
    const { templates, selectedTemplateId } = get();
    return templates.find((t) => t.id === selectedTemplateId);
  },

  createTemplate: async (template) => {
    const created = await templateApi.createTemplate(template);
    set((state) => ({
      templates: [...state.templates, created],
      selectedTemplateId: created.id,
    }));
    return created;
  },

  updateTemplate: async (id, updates) => {
    const updated = await templateApi.updateTemplate(id, updates);
    set((state) => ({
      templates: state.templates.map((t) => (t.id === id ? updated : t)),
    }));
  },

  deleteTemplate: async (id) => {
    await templateApi.deleteTemplate(id);
    set((state) => {
      const templates = state.templates.filter((t) => t.id !== id);
      return {
        templates,
        selectedTemplateId:
          state.selectedTemplateId === id
            ? templates[0]?.id ?? null
            : state.selectedTemplateId,
      };
    });
  },

  exportTemplate: async (id) => {
    await templateApi.exportTemplate(id);
  },

  startEditing: (id) => set({ editingTemplateId: id }),
  stopEditing: () => set({ editingTemplateId: null }),
}));
