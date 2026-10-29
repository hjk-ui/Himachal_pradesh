'use client';
import { useMemo, useState } from 'react';
import { FileText, Music, Video, Newspaper, Search, Download, Upload, LayoutGrid, List, FolderOpen, ClipboardList, Stethoscope } from 'lucide-react';
import { useClients } from '@/features/clients';
import { useModuleList } from '@/lib/modules/useModuleList';
import { downloadTextFile, slugFilename } from '@/lib/browser/downloadFile';

const CATEGORIES = ['All', 'Anxiety', 'Depression', 'Trauma', 'Mindfulness', 'Crisis', 'Family', 'Substance Use', 'Grief'];

type ResourceType = 'Worksheet' | 'Audio Guide' | 'Video' | 'Article';

type LibraryResource = {
  id: number | string;
  title: string;
  type: ResourceType;
  category: string;
  format: string;
  description: string;
  author: string;
  tags: string[];
  downloads: number;
  featured: boolean;
  color: string;
  uploaded?: boolean;
  fileUrl?: string;
};

function downloadResource(resource: LibraryResource) {
  if (resource.fileUrl) {
    const a = document.createElement('a');
    a.href = resource.fileUrl;
    a.download = slugFilename(resource.title, resource.format.toLowerCase());
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return;
  }

  const body = [
    resource.title,
    '',
    resource.description,
    '',
    `Type: ${resource.type}`,
    `Format: ${resource.format}`,
    `Category: ${resource.category}`,
    `Author: ${resource.author}`,
    resource.tags.length ? `Tags: ${resource.tags.join(', ')}` : '',
    '',
    'This file was generated from the clinic resource library. Attach a stored URL or upload a blob to serve the original media.',
  ]
    .filter((line) => line !== undefined)
    .join('\n');
  downloadTextFile(slugFilename(resource.title, 'txt'), body);
}

type ResourceAssignment = {
  id: string;
  resourceId: string;
  resourceTitle: string;
  clientId: string;
  clientName: string;
  message: string;
  dueDate: string;
  assignedAt: string;
};

function ResourceIcon({ type, size = 20, className = '' }: { type: string; size?: number; className?: string }) {
  if (type === 'Worksheet') return <FileText size={size} className={className} />;
  if (type === 'Audio Guide') return <Music size={size} className={className} />;
  if (type === 'Video') return <Video size={size} className={className} />;
  return <Newspaper size={size} className={className} />;
}



const TYPE_COLORS: Record<string, string> = {
  Worksheet: 'bg-blue-100 text-blue-700',
  'Audio Guide': 'bg-blue-100 text-blue-700',
  Video: 'bg-blue-100 text-blue-700',
  Article: 'bg-amber-100 text-amber-700',
};

export default function ResourceLibraryPage() {
  const { clients } = useClients();
  const [uploads, setUploads] = useModuleList<LibraryResource>('resource-uploads', []);
  const [assignments, setAssignments] = useModuleList<ResourceAssignment>('resource-assignments', []);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [selectedResource, setSelectedResource] = useState<LibraryResource | null>(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignResource, setAssignResource] = useState<LibraryResource | null>(null);
  const [assignClientId, setAssignClientId] = useState('');
  const [assignMessage, setAssignMessage] = useState('');
  const [assignDue, setAssignDue] = useState('');
  const [assignSaved, setAssignSaved] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    title: '',
    type: 'Worksheet' as ResourceType,
    category: 'Anxiety',
    description: '',
  });

  const resources = useMemo(() => uploads, [uploads]);

  const filtered = resources.filter(r => {
    const matchCat = activeCategory === 'All' || r.category === activeCategory;
    const matchSearch = !searchQuery || r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.tags.some(t => t.includes(searchQuery.toLowerCase()));
    return matchCat && matchSearch;
  });

  const featured = resources.filter(r => r.featured);

  const handleUpload = () => {
    if (!uploadForm.title.trim()) return;
    const row: LibraryResource = {
      id: `up-${Date.now()}`,
      title: uploadForm.title.trim(),
      type: uploadForm.type,
      category: uploadForm.category,
      format: uploadForm.type === 'Audio Guide' ? 'MP3' : uploadForm.type === 'Video' ? 'MP4' : 'PDF',
      description: uploadForm.description.trim() || 'Clinic-uploaded resource',
      author: 'Clinic staff',
      tags: [uploadForm.category.toLowerCase()],
      downloads: 0,
      featured: false,
      color: '#6868D0',
      uploaded: true,
    };
    setUploads((prev) => [row, ...prev]);
    setUploadForm({ title: '', type: 'Worksheet', category: 'Anxiety', description: '' });
    setUploadOpen(false);
  };

  const handleAssign = () => {
    if (!assignResource || !assignClientId) return;
    const client = clients.find((c) => c.id === assignClientId);
    setAssignments((prev) => [
      {
        id: `asg-${Date.now()}`,
        resourceId: String(assignResource.id),
        resourceTitle: assignResource.title,
        clientId: assignClientId,
        clientName: client?.name || 'Client',
        message: assignMessage.trim(),
        dueDate: assignDue,
        assignedAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    setAssignSaved(true);
    setTimeout(() => {
      setAssignModalOpen(false);
      setAssignResource(null);
      setAssignClientId('');
      setAssignMessage('');
      setAssignDue('');
      setAssignSaved(false);
    }, 900);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Resource Library</h1>
          <p className="text-slate-500 text-sm mt-0.5">Worksheets, guided audio, videos & articles for clients and clinicians</p>
        </div>
        <button
          onClick={() => setUploadOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm"
          style={{ background: 'linear-gradient(135deg, #6868D0, #1e40af)' }}
        >
          <Upload size={15} /> Upload Resource
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Resources', value: resources.length, icon: FileText, color: '#6868D0', bg: '#EEF0FE' },
          { label: 'Clinic uploads', value: String(uploads.length), icon: Download, color: '#6868D0', bg: '#EEF0FE' },
          { label: 'Active Assignments', value: String(assignments.length), icon: ClipboardList, color: '#D4A017', bg: '#FEF9E7' },
          { label: 'Catalog worksheets', value: String(uploads.length), icon: Stethoscope, color: '#ea580c', bg: '#fff7ed' },
        ].map(stat => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-white rounded-xl p-4 shadow-sm border border-slate-200/80">
              <div className="flex items-center justify-between mb-2">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: stat.bg }}>
                  <Icon size={17} style={{ color: stat.color }} />
                </div>
                <span className="text-2xl font-bold" style={{ color: stat.color }}>{stat.value}</span>
              </div>
              <p className="text-xs text-slate-500">{stat.label}</p>
            </div>
          );
        })}
      </div>

      {/* Featured Resources */}
      <div>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Featured Resources</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {featured.map(r => (
            <div
              key={r.id}
              className="rounded-xl p-5 text-white cursor-pointer hover:opacity-90 transition-opacity shadow-md"
              style={{ background: `linear-gradient(135deg, ${r.color}dd, ${r.color}88)` }}
              onClick={() => setSelectedResource(r)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center">
                  <ResourceIcon type={r.type} size={18} className="text-white" />
                </div>
                <span className="text-xs bg-white/20 rounded-full px-2 py-0.5">{r.format}</span>
              </div>
              <h3 className="font-bold text-sm leading-snug mb-1">{r.title}</h3>
              <p className="text-white/80 text-xs mb-3 line-clamp-2">{r.description}</p>
              <div className="flex items-center justify-between text-xs text-white/70">
                <span>{r.downloads} downloads</span>
                <span>{r.category}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Search + Filter */}
      <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200/80">
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by title, description, or tag..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2.5 rounded-xl text-sm ${viewMode === 'grid' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2.5 rounded-xl text-sm ${viewMode === 'list' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}
            >
              <List size={16} />
            </button>
          </div>
        </div>

        {/* Category pills */}
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                activeCategory === cat
                  ? 'text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
              style={activeCategory === cat ? { background: '#6868D0' } : {}}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Resource Grid / List */}
      {viewMode === 'grid' ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(r => (
            <div
              key={r.id}
              className="bg-white rounded-xl shadow-sm border border-slate-200/80 p-5 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => setSelectedResource(r)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center">
                    <ResourceIcon type={r.type} size={16} className="text-slate-500" />
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[r.type] || 'bg-slate-100 text-slate-600'}`}>
                    {r.type}
                  </span>
                </div>
                <span className="text-xs text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full">{r.format}</span>
              </div>
              <h3 className="font-semibold text-slate-900 text-sm leading-snug mb-1">{r.title}</h3>
              <p className="text-slate-500 text-xs mb-3 line-clamp-2">{r.description}</p>
              <div className="flex flex-wrap gap-1 mb-3">
                {r.tags.map(tag => (
                  <span key={tag} className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">#{tag}</span>
                ))}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{r.downloads} downloads</span>
                <div className="flex gap-2">
                  <button
                    onClick={e => { e.stopPropagation(); setAssignResource(r); setAssignModalOpen(true); }}
                    className="text-xs px-3 py-1.5 rounded-lg text-blue-700 bg-blue-50 hover:bg-blue-100 font-medium"
                  >
                    Assign
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); downloadResource(r); }}
                    className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg text-slate-600 bg-slate-50 hover:bg-slate-100 font-medium"
                  >
                    <Download size={12} /> Download
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200/80 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200/80">
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Resource</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Type</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">Category</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Author</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center">
                        <ResourceIcon type={r.type} size={15} className="text-slate-500" />
                      </div>
                      <div>
                        <p className="font-medium text-sm text-slate-900">{r.title}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{r.downloads} downloads · {r.format}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 hidden sm:table-cell">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[r.type] || ''}`}>{r.type}</span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 hidden md:table-cell">{r.category}</td>
                  <td className="px-6 py-4 text-sm text-slate-600 hidden lg:table-cell">{r.author}</td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => { setAssignResource(r); setAssignModalOpen(true); }}
                        className="text-xs px-3 py-1.5 rounded-lg text-blue-700 bg-blue-50 hover:bg-blue-100 font-medium"
                      >Assign</button>
                      <button
                        type="button"
                        onClick={() => downloadResource(r)}
                        className="p-1.5 rounded-lg text-slate-600 bg-slate-50 hover:bg-slate-100"
                      >
                        <Download size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="text-center py-16 text-slate-400">
          <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
            <FolderOpen size={28} className="text-slate-300" />
          </div>
          <p className="text-sm">No resources match your search</p>
        </div>
      )}

      {/* Resource Detail Modal */}
      {selectedResource && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-clinic-md w-full max-w-lg">
            <div className="p-6 rounded-t-2xl" style={{ background: `linear-gradient(135deg, ${selectedResource.color}22, #fff)` }}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: selectedResource.color + '20', color: selectedResource.color }}
                  >
                    <ResourceIcon type={selectedResource.type} size={22} />
                  </div>
                  <div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[selectedResource.type] || ''}`}>
                      {selectedResource.type}
                    </span>
                    <h2 className="font-semibold text-slate-900 text-lg mt-1 leading-snug">{selectedResource.title}</h2>
                  </div>
                </div>
                <button onClick={() => setSelectedResource(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-slate-600 text-sm">{selectedResource.description}</p>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-slate-400 text-xs">Author</span><p className="font-medium text-slate-800">{selectedResource.author}</p></div>
                <div><span className="text-slate-400 text-xs">Category</span><p className="font-medium text-slate-800">{selectedResource.category}</p></div>
                <div><span className="text-slate-400 text-xs">Format</span><p className="font-medium text-slate-800">{selectedResource.format}</p></div>
                <div><span className="text-slate-400 text-xs">Downloads</span><p className="font-medium text-slate-800">{selectedResource.downloads}</p></div>
              </div>
              <div className="flex flex-wrap gap-1">
                {selectedResource.tags.map(t => (
                  <span key={t} className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">#{t}</span>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => { setSelectedResource(null); setAssignResource(selectedResource); setAssignModalOpen(true); }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                  style={{ background: '#6868D0' }}
                >
                  Assign to Client
                </button>
                <button
                  type="button"
                  onClick={() => downloadResource(selectedResource)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100"
                >
                  <Download size={14} /> Download
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assign Modal */}
      {assignModalOpen && assignResource && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-clinic-md w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Assign to Client</h2>
              <button onClick={() => setAssignModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
            </div>
            <p className="text-sm text-slate-500 mb-4">Assigning:<span className="font-medium text-slate-800">{assignResource.title}</span></p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Select Client</label>
                <select
                  value={assignClientId}
                  onChange={(e) => setAssignClientId(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="">Select a client</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Message (optional)</label>
                <textarea
                  rows={3}
                  value={assignMessage}
                  onChange={(e) => setAssignMessage(e.target.value)}
                  placeholder="Add a personal note for the client..."
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Due Date (optional)</label>
                <input
                  type="date"
                  value={assignDue}
                  onChange={(e) => setAssignDue(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setAssignModalOpen(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200">Cancel</button>
              <button
                onClick={handleAssign}
                disabled={!assignClientId}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: '#6868D0' }}
              >
                {assignSaved ? 'Assigned' : 'Assign Resource'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      {uploadOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-clinic-md w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Upload New Resource</h2>
              <button onClick={() => setUploadOpen(false)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">&times;</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
                <input
                  type="text"
                  value={uploadForm.title}
                  onChange={(e) => setUploadForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Resource title..."
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
                  <select
                    value={uploadForm.type}
                    onChange={(e) => setUploadForm((f) => ({ ...f, type: e.target.value as ResourceType }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    <option>Worksheet</option>
                    <option>Audio Guide</option>
                    <option>Video</option>
                    <option>Article</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                  <select
                    value={uploadForm.category}
                    onChange={(e) => setUploadForm((f) => ({ ...f, category: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                  >
                    {CATEGORIES.filter(c => c !== 'All').map(c =><option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={uploadForm.description}
                  onChange={(e) => setUploadForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
                />
              </div>
              <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-2">
                  <FolderOpen size={20} className="text-slate-400" />
                </div>
                <p className="text-sm text-slate-500">Drag & drop file here, or<span className="text-blue-600 font-medium cursor-pointer">browse</span></p>
                <p className="text-xs text-slate-400 mt-1">PDF, MP3, MP4 up to 100MB</p>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setUploadOpen(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200">Cancel</button>
              <button
                onClick={handleUpload}
                disabled={!uploadForm.title.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: '#6868D0' }}
              >
                Upload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
