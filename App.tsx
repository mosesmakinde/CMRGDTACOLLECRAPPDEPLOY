import { useEffect, useMemo, useState } from 'react';
import { api } from '@appdeploy/client';
import { QRCodeSVG } from 'qrcode.react';
import {
  Activity,
  AudioLines,
  CheckCircle2,
  ClipboardList,
  Download,
  FileUp,
  Flag,
  MapPin,
  Plus,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Upload,
  Users,
  X,
} from 'lucide-react';
import './index.css';
import './pwa.css';

type Question = {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
};
type Project = {
  id: string;
  title: string;
  description?: string;
  accessCode: string;
  questions: Question[];
  createdAt: string;
};
type Submission = {
  id: string;
  projectId: string;
  projectTitle: string;
  enumerator: string;
  answers: Record<string, string>;
  latitude?: number;
  longitude?: number;
  audioStatus: string;
  audioUrl?: string;
  reviewStatus: string;
  submittedAt: string;
};
const makeId = () => Math.random().toString(36).slice(2, 10).toUpperCase();
const starterQuestions: Question[] = [
  {
    id: makeId(),
    label: 'Respondent name or identifier',
    type: 'text',
    required: true,
  },
  {
    id: makeId(),
    label: 'How would you rate this service?',
    type: 'select',
    options: ['Very good', 'Good', 'Fair', 'Poor'],
    required: true,
  },
  { id: makeId(), label: 'Additional comments', type: 'textarea' },
];

export default function App() {
  const [page, setPage] = useState<
    'overview' | 'projects' | 'situation' | 'enumerator' | 'audio-upload'
  >('overview');
  const [projects, setProjects] = useState<Project[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const appInstallUrl = window.location.origin + window.location.pathname;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [questions, setQuestions] = useState<Question[]>(starterQuestions);
  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [code, setCode] = useState('');
  const [enumerator, setEnumerator] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [coords, setCoords] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [audioStatus, setAudioStatus] = useState('Not recorded');
  const [audioUploadId, setAudioUploadId] = useState('');
  const [recording, setRecording] = useState(false);
  const [reviewFilter, setReviewFilter] = useState('All');
  const [importText, setImportText] = useState('');
  const shareUrl = useMemo(
    () =>
      activeProject
        ? window.location.href.split('#')[0] + '#form/' + activeProject.id
        : '',
    [activeProject]
  );
  async function load() {
    setBusy(true);
    try {
      const [p, s] = await Promise.all([
        api.get('/api/projects'),
        api.get('/api/submissions'),
      ]);
      setProjects(p.data.projects || []);
      setSubmissions(s.data.submissions || []);
    } catch {
      setNotice('Could not load saved records. Please refresh and try again.');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener('beforeinstallprompt', captureInstallPrompt);
    window.addEventListener('appinstalled', () => setInstallPrompt(null));
    const hash = window.location.hash;
    if (hash.startsWith('#audio/')) {
      setAudioUploadId(decodeURIComponent(hash.slice(7)));
      setPage('audio-upload');
    }
    if (hash.startsWith('#form/')) {
      const id = hash.slice(6);
      api
        .get('/api/projects')
        .then(r => {
          const p = (r.data.projects || []).find((x: Project) => x.id === id);
          if (p) {
            setActiveProject(p);
            setPage('enumerator');
          }
        })
        .catch(() => {});
    }
  }, []);
  async function installApp() {
    if (installPrompt) {
      await installPrompt.prompt();
      setInstallPrompt(null);
    } else {
      setShowInstallHelp(true);
    }
  }
  async function createProject() {
    if (!title.trim() || !questions.length) {
      setNotice('Add a project title and at least one question.');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post('/api/projects', {
        title: title.trim(),
        description,
        questions,
        accessCode: makeId().slice(0, 6),
      });
      setActiveProject(r.data.project);
      setShowCreate(false);
      setTitle('');
      setDescription('');
      await load();
      setNotice(
        'Project saved. Share its QR code and access code with enumerators.'
      );
    } catch {
      setNotice('Project could not be saved. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  function addQuestion() {
    setQuestions(q => [
      ...q,
      { id: makeId(), label: 'New question', type: 'text', required: false },
    ]);
  }
  async function importFile(file: File) {
    try {
      const text = await file.text();
      let qs: Question[] = [];
      if (file.name.toLowerCase().endsWith('.json')) {
        const raw = JSON.parse(text);
        const list = Array.isArray(raw) ? raw : raw.questions || raw.fields;
        if (!Array.isArray(list))
          throw new Error('JSON must contain a questions or fields array.');
        qs = list.map((q: any, i) => ({
          id: String(q.id || makeId()),
          label: String(
            q.label || q.question || q.name || 'Question ' + (i + 1)
          ),
          type: ['text', 'textarea', 'number', 'select', 'yesno'].includes(
            q.type
          )
            ? q.type
            : 'text',
          required: !!q.required,
          options: Array.isArray(q.options) ? q.options.map(String) : undefined,
        }));
      } else {
        const lines = text.split(/\r?\n/).filter(Boolean);
        const header = lines.shift()?.toLowerCase() || '';
        const rows = lines.map(x =>
          x.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
        );
        qs = rows.map((r, i) => ({
          id: makeId(),
          label:
            r[
              header.includes('question')
                ? header.split(',').indexOf('question')
                : 0
            ] ||
            r[0] ||
            'Question ' + (i + 1),
          type: 'text',
          required: false,
        }));
      }
      if (!qs.length) throw new Error('No questions found.');
      setQuestions(qs);
      setNotice(
        'Imported ' +
          qs.length +
          ' questions. Review them before saving the project.'
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not import this file.');
    }
  }
  async function captureLocation() {
    if (!navigator.geolocation) {
      setNotice('Location is not supported on this device.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      p => {
        setCoords({
          latitude: Number(p.coords.latitude.toFixed(6)),
          longitude: Number(p.coords.longitude.toFixed(6)),
        });
        setNotice('GPS coordinates captured.');
      },
      () =>
        setNotice(
          'Location permission denied or unavailable. You can still submit without GPS.'
        ),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }
  async function startAudio() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = e => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onstop = () => {
        const recordingBlob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        setAudio(recordingBlob);
        setAudioStatus('Recording saved to phone Downloads — upload it using the interviewer link');
        const downloadUrl = URL.createObjectURL(recordingBlob);
        const downloadLink = document.createElement('a');
        downloadLink.href = downloadUrl;
        downloadLink.download = 'CMRG-audio-' + new Date().toISOString().replace(/[:.]/g, '-') + '.webm';
        downloadLink.click();
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1500);
        stream.getTracks().forEach(t => t.stop());
      };
      rec.start();
      setRecording(true);
      (window as any).__cmrgRecorder = rec;
    } catch {
      setNotice('Microphone permission unavailable. Audio was not recorded.');
      setAudioStatus('Permission unavailable');
    }
  }
  function stopAudio() {
    const rec = (window as any).__cmrgRecorder as MediaRecorder | undefined;
    if (rec && rec.state !== 'inactive') rec.stop();
    setRecording(false);
  }
  async function submitResponse() {
    if (!activeProject) {
      setNotice('Open a project first.');
      return;
    }
    if (!enumerator.trim()) {
      setNotice('Enter your enumerator name or ID.');
      return;
    }
    if (!code.trim()) {
      setNotice('Enter the project access code.');
      return;
    }
    setBusy(true);
    try {
      // Audio is uploaded separately through the interviewer audio-upload link.
      const r = await api.post('/api/submissions', {
        projectId: activeProject.id,
        accessCode: code,
        enumerator,
        answers,
        latitude: coords?.latitude,
        longitude: coords?.longitude,
        audioStatus: 'Awaiting audio upload',
      });
      setNotice(r.data.message || 'Response submitted. Share the interviewer audio-upload link separately.');
      setAnswers({});
      setAudio(null);
      setAudioStatus('Awaiting audio upload');
      await load();
    } catch (e) {
      setNotice(
        'Submission failed. Check the access code and network, then retry.'
      );
    } finally {
      setBusy(false);
    }
  }
  async function uploadAudioFile(file: File) {
    if (!audioUploadId) return;
    if (!file.type.startsWith('audio/')) {
      setNotice('Choose an audio file such as WAV, MP3, M4A, or WEBM.');
      return;
    }
    if (file.size > 3_500_000) {
      setNotice('This basic release accepts audio files up to about 3.5 MB.');
      return;
    }
    setBusy(true);
    try {
      const audioBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      await api.post('/api/submissions/' + audioUploadId + '/audio', {
        audioBase64,
        contentType: file.type || 'audio/webm',
        fileName: file.name,
      });
      setNotice('Audio upload confirmed by the server. Situation Room will show Uploaded after refresh.');
      await load();
    } catch {
      setNotice('Audio upload failed. Check the connection and file size, then retry.');
    } finally {
      setBusy(false);
    }
  }
  async function updateReview(s: Submission, status: string) {
    try {
      await api.put('/api/submissions/' + s.id, { reviewStatus: status });
      await load();
    } catch {
      setNotice('Could not update review status.');
    }
  }
  const visibleSubs = submissions.filter(
    s =>
      (reviewFilter === 'All' || s.reviewStatus === reviewFilter) &&
      (s.projectTitle + ' ' + s.enumerator + ' ' + s.id)
        .toLowerCase()
        .includes(search.toLowerCase())
  );
  const stats = [
    { label: 'Active projects', value: projects.length, icon: ClipboardList },
    { label: 'Submissions', value: submissions.length, icon: Users },
    {
      label: 'Audio attached',
      value: submissions.filter(s => s.audioStatus === 'Uploaded').length,
      icon: AudioLines,
    },
    {
      label: 'Needs review',
      value: submissions.filter(
        s => s.reviewStatus === 'Pending' || s.reviewStatus === 'Flagged'
      ).length,
      icon: Activity,
    },
  ];
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandmark">C</div>
          <div>
            <b>CMRG</b>
            <small>DATA COLLECT</small>
          </div>
        </div>
        <div className="workspace">
          <span className="dot" /> Field Research Workspace
        </div>
        <div className="navlabel">WORKSPACE</div>
        <button
          className={'nav ' + (page === 'overview' ? 'active' : '')}
          onClick={() => setPage('overview')}
        >
          <Activity size={18} /> Overview
        </button>
        <button
          className={'nav ' + (page === 'projects' ? 'active' : '')}
          onClick={() => setPage('projects')}
        >
          <ClipboardList size={18} /> Questionnaires
        </button>
        <button
          className={'nav ' + (page === 'situation' ? 'active' : '')}
          onClick={() => setPage('situation')}
        >
          <MapPin size={18} /> Situation Room{' '}
          <span className="navcount">
            {submissions.filter(s => s.reviewStatus === 'Pending').length}
          </span>
        </button>
        <button
          className={'nav ' + (page === 'enumerator' ? 'active' : '')}
          onClick={() => {
            setPage('enumerator');
            if (!activeProject && projects[0]) setActiveProject(projects[0]);
          }}
        >
          <Smartphone size={18} /> Phone collection
        </button>
        <div className="sidebarbottom">
          <div className="secure">
            <ShieldCheck size={18} />
            <div>
              <b>Field data workspace</b>
              <small>Keep access codes private</small>
            </div>
          </div>
          <small>CMRG • Research operations</small>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="crumb">
            Workspace <span>/</span>{' '}
            {page === 'overview'
              ? 'Overview'
              : page === 'projects'
                ? 'Questionnaires'
                : page === 'situation'                ? 'Situation Room'
                : page === 'audio-upload'
                  ? 'Audio upload'
                  : 'Phone collection'}
          </div>
          <div className="topright">
            <span className="live">
              <i /> Workspace ready
            </span>
            <button className="iconbtn" onClick={load} title="Refresh">
              <RefreshCw size={17} />
            </button>
            <div className="avatar">CM</div>
          </div>
        </header>
        <div className="content">
          {notice && (
            <div className="notice" role="status">
              {notice}
              <button onClick={() => setNotice('')}>
                <X size={15} />
              </button>
            </div>
          )}
          {page === 'overview' && (
            <>
              <div className="pagehead">
                <div>
                  <div className="eyebrow">FIELD OPERATIONS / OVERVIEW</div>
                  <h1>Good morning, Research Team</h1>
                  <p>
                    Manage questionnaires, collect field responses, and monitor
                    data quality in one place.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    setQuestions(starterQuestions);
                    setShowCreate(true);
                  }}
                >
                  <Plus size={17} /> New questionnaire
                </button>
              </div>
              <section className="panel appinstall-panel">
                <div className="appinstall-copy">
                  <span className="eyebrow">ENUMERATOR APP</span>
                  <h2>Get CMRG Collect on your phone</h2>
                  <p>Scan this QR code with your phone camera to open the CMRG collection app. Then add it to your home screen so it feels like an app. This is the app-install QR, not a project survey QR.</p>
                  <div className="install-actions">
                    <button className="primary" onClick={installApp}><Download size={16} /> Install / add to home screen</button>
                    <button className="secondary" onClick={() => { navigator.clipboard?.writeText(appInstallUrl); setNotice('CMRG Collect app link copied when clipboard access is available.'); }}>Copy app link</button>
                  </div>
                  {showInstallHelp && <div className="install-help"><b>Android:</b> open this link in Chrome, tap the browser menu, then choose <b>Install app</b> or <b>Add to Home screen</b>.<br/><b>iPhone:</b> open this link in Safari, tap Share, then choose <b>Add to Home Screen</b>.<br/><span>The QR code opens the CMRG web app; it does not install a Play Store APK.</span></div>}
                </div>
                <div className="appinstall-qr"><QRCodeSVG value={appInstallUrl} size={156} level="M" includeMargin /><b>Scan to open CMRG Collect</b><small>App access · {window.location.host}</small></div>
              </section>
              <div className="stats">
                {stats.map((s, i) => (
                  <div className="stat" key={s.label}>
                    <div className={'staticon c' + i}>
                      <s.icon size={19} />
                    </div>
                    <span>{s.label}</span>
                    <strong>{s.value}</strong>
                    <small>
                      {i === 3
                        ? 'Pending or flagged records'
                        : 'Across this workspace'}
                    </small>
                  </div>
                ))}
              </div>
              <div className="gridmain">
                <section className="panel">
                  <div className="panelhead">
                    <div>
                      <h2>Recent questionnaires</h2>
                      <p>Projects ready for field collection</p>
                    </div>
                    <button
                      className="textbtn"
                      onClick={() => setPage('projects')}
                    >
                      View all <span>→</span>
                    </button>
                  </div>
                  {projects.length === 0 ? (
                    <div className="empty">
                      <div className="emptyicon">
                        <ClipboardList />
                      </div>
                      <b>No questionnaires yet</b>
                      <p>
                        Create one or import an existing questionnaire to get
                        started.
                      </p>
                      <button
                        className="primary"
                        onClick={() => {
                          setQuestions(starterQuestions);
                          setShowCreate(true);
                        }}
                      >
                        <Plus size={16} /> Create first questionnaire
                      </button>
                    </div>
                  ) : (
                    <div className="projectlist">
                      {projects.slice(0, 5).map(p => (
                        <div className="projectrow" key={p.id}>
                          <div className="projecticon">
                            <ClipboardList size={19} />
                          </div>
                          <div className="projectinfo">
                            <b>{p.title}</b>
                            <small>
                              {p.questions.length} questions · Code{' '}
                              {p.accessCode}
                            </small>
                          </div>
                          <button
                            className="iconbtn"
                            onClick={() => {
                              setActiveProject(p);
                              setNotice(
                                'Share the QR code and access code with enumerators.'
                              );
                            }}
                            title="Show QR access"
                          >
                            <QrCode size={17} />
                          </button>
                          <button
                            className="smallbtn"
                            onClick={() => {
                              setActiveProject(p);
                              setPage('enumerator');
                              setCode(p.accessCode);
                            }}
                          >
                            Open form
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
                <section className="panel">
                  <div className="panelhead">
                    <div>
                      <h2>Fieldwork pulse</h2>
                      <p>Latest incoming records</p>
                    </div>
                    <span className="tag green">
                      <i /> Live data
                    </span>
                  </div>
                  <div className="pulse">
                    <div className="pulsemetric">
                      <span>Responses received</span>
                      <b>{submissions.length}</b>
                      <small>Total saved submissions</small>
                    </div>
                    <div className="pulsemetric">
                      <span>GPS coordinates</span>
                      <b>
                        {
                          submissions.filter(
                            s =>
                              s.latitude !== undefined &&
                              s.longitude !== undefined
                          ).length
                        }
                      </b>
                      <small>With location captured</small>
                    </div>
                    <div className="pulsemetric">
                      <span>Audio uploads</span>
                      <b>
                        {
                          submissions.filter(s => s.audioStatus === 'Uploaded')
                            .length
                        }
                      </b>
                      <small>Successfully stored audio</small>
                    </div>
                  </div>
                  <button
                    className="secondary wide"
                    onClick={() => setPage('situation')}
                  >
                    Open Situation Room <span>→</span>
                  </button>
                </section>
              </div>
              <section className="panel recentpanel">
                <div className="panelhead">
                  <div>
                    <h2>Latest submissions</h2>
                    <p>Check data completeness and media status</p>
                  </div>
                  <button
                    className="textbtn"
                    onClick={() => setPage('situation')}
                  >
                    Review submissions →
                  </button>
                </div>
                <SubmissionTable
                  rows={submissions.slice(0, 4)}
                  onReview={updateReview}
                />
              </section>
            </>
          )}
          {page === 'projects' && (
            <>
              <div className="pagehead">
                <div>
                  <div className="eyebrow">FIELD OPERATIONS / SETUP</div>
                  <h1>Questionnaires</h1>
                  <p>
                    Create new surveys or import existing JSON and CSV question
                    lists.
                  </p>
                </div>
                <button
                  className="primary"
                  onClick={() => {
                    setQuestions(starterQuestions);
                    setShowCreate(true);
                  }}
                >
                  <Plus size={17} /> New questionnaire
                </button>
              </div>
              <div className="panel importpanel">
                <div className="importicon">
                  <FileUp size={22} />
                </div>
                <div className="importcopy">
                  <b>Have an existing questionnaire?</b>
                  <p>
                    Import a JSON file containing a questions array, or a CSV
                    with a question column. Review before saving.
                  </p>
                </div>
                <label className="secondary uploadbtn">
                  <Upload size={16} /> Import file
                  <input
                    type="file"
                    accept=".json,.csv"
                    onChange={e =>
                      e.target.files?.[0] && importFile(e.target.files[0])
                    }
                  />
                </label>
              </div>
              <div className="panel">
                <div className="panelhead">
                  <div>
                    <h2>All projects</h2>
                    <p>{projects.length} questionnaire projects</p>
                  </div>
                  <div className="searchbox">
                    <input
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search projects…"
                    />
                  </div>
                </div>
                {projects.filter(p =>
                  p.title.toLowerCase().includes(search.toLowerCase())
                ).length === 0 ? (
                  <div className="empty compact">
                    <b>No matching projects</b>
                    <p>Make a questionnaire to begin collecting field data.</p>
                  </div>
                ) : (
                  <div className="projectlist">
                    {projects
                      .filter(p =>
                        p.title.toLowerCase().includes(search.toLowerCase())
                      )
                      .map(p => (
                        <div className="projectrow" key={p.id}>
                          <div className="projecticon">
                            <ClipboardList size={19} />
                          </div>
                          <div className="projectinfo">
                            <b>{p.title}</b>
                            <small>
                              {p.questions.length} questions · Access code{' '}
                              {p.accessCode}
                            </small>
                          </div>
                          <button
                            className="secondary"
                            onClick={() => {
                              setActiveProject(p);
                              setPage('enumerator');
                              setCode(p.accessCode);
                            }}
                          >
                            Preview form
                          </button>
                          <button
                            className="iconbtn"
                            onClick={() => setActiveProject(p)}
                          >
                            <QrCode size={17} />
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
              {activeProject && (
                <div className="panel sharepanel">
                  <div className="panelhead">
                    <div>
                      <h2>Share: {activeProject.title}</h2>
                      <p>
                        Enumerators scan the QR code, enter the access code,
                        then submit from their phone.
                      </p>
                    </div>
                    <button
                      className="iconbtn"
                      onClick={() => setActiveProject(null)}
                    >
                      <X />
                    </button>
                  </div>
                  <div className="sharebody">
                    <div className="qrwrap">
                      <QRCodeSVG value={shareUrl} size={172} />
                    </div>
                    <div>
                      <span className="eyebrow">ENUMERATOR ACCESS CODE</span>
                      <div className="accesscode">
                        {activeProject.accessCode}
                      </div>
                      <p className="muted">
                        Share the website URL/QR and code only with your field
                        team. This basic release uses a project access code, not
                        individual staff accounts.
                      </p>
                      <button
                        className="secondary"
                        onClick={() => {
                          navigator.clipboard?.writeText(shareUrl);
                          setNotice(
                            'Share link copied when clipboard access is available.'
                          );
                        }}
                      >
                        Copy collection link
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          {page === 'situation' && (
            <>
              <div className="pagehead">
                <div>
                  <div className="eyebrow">FIELD OPERATIONS / MONITORING</div>
                  <h1>Situation Room</h1>
                  <p>
                    Monitor submissions, GPS evidence, audio uploads, and
                    fieldwork review flags.
                  </p>
                </div>
                <button className="secondary" onClick={load}>
                  <RefreshCw size={16} /> Refresh feed
                </button>
              </div>
              <div className="stats compactstats">
                {[
                  { label: 'Total received', value: submissions.length },
                  {
                    label: 'GPS captured',
                    value: submissions.filter(
                      s => s.latitude !== undefined && s.longitude !== undefined
                    ).length,
                  },
                  {
                    label: 'Audio uploaded',
                    value: submissions.filter(s => s.audioStatus === 'Uploaded')
                      .length,
                  },
                  {
                    label: 'Flagged',
                    value: submissions.filter(s => s.reviewStatus === 'Flagged')
                      .length,
                  },
                ].map((s, i) => (
                  <div className="stat minis" key={s.label}>
                    <span>{s.label}</span>
                    <strong>{s.value}</strong>
                  </div>
                ))}
              </div>
              <div className="panel">
                <div className="panelhead wraphead">
                  <div>
                    <h2>Incident & submission feed</h2>
                    <p>
                      Latest records first · audio and GPS statuses reflect
                      received data
                    </p>
                  </div>
                  <div className="filterrow">
                    <select
                      value={reviewFilter}
                      onChange={e => setReviewFilter(e.target.value)}
                    >
                      <option>All</option>
                      <option>Pending</option>
                      <option>Verified</option>
                      <option>Flagged</option>
                    </select>
                    <div className="searchbox">
                      <input
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        placeholder="Search enumerator or project"
                      />
                    </div>
                  </div>
                </div>
                <SubmissionTable
                  rows={visibleSubs}
                  onReview={updateReview}
                  detailed
                />
              </div>
              <div className="footnote">
                Location requires the enumerator's permission and device
                support. Audio is marked uploaded only when the server confirms
                storage; a recording on the phone is not yet a successful
                upload.
              </div>
            </>
          )}
          {page === 'audio-upload' && (
            <>
              <div className="pagehead">
                <div>
                  <div className="eyebrow">FIELD OPERATIONS / MEDIA</div>
                  <h1>Interviewer audio upload</h1>
                  <p>Choose the recording for this field record. The Situation Room status changes to Uploaded only after the server confirms it is stored.</p>
                </div>
                <span className="tag"><AudioLines size={14} /> Interviewer upload link</span>
              </div>
              <div className="panel audio-upload-panel">
                {(() => {
                  const record = submissions.find(s => s.id === audioUploadId);
                  if (!record) return <div className="empty compact"><b>Field record not found yet</b><p>Refresh the page or ask the supervisor to copy the audio upload link again.</p><button className="secondary" onClick={load}><RefreshCw size={15} /> Refresh record</button></div>;
                  return <>
                    <div className="upload-record"><span className="eyebrow">FIELD RECORD</span><h2>{record.projectTitle}</h2><p>Enumerator: <b>{record.enumerator}</b> · Record ID: {record.id.slice(0, 14)}</p><span className={'badge ' + (record.audioStatus === 'Uploaded' ? 'ok' : 'pending')}>{record.audioStatus}</span></div>
                    {record.audioUrl && <audio controls src={record.audioUrl} className="audio-preview" />}
                    <label className="fieldlabel audio-file-field">Select audio recording
                      <input type="file" accept="audio/*,.wav,.mp3,.m4a,.webm,.aac,.ogg" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) uploadAudioFile(file); e.currentTarget.value = ''; }} />
                    </label>
                    <p className="privacyhint">Accepted: audio recordings up to about 3.5 MB in this basic release. Keep this link with the assigned interviewer. Upload status is verified by the server, not by selecting a file.</p>
                  </>;
                })()}
              </div>
            </>
          )}
          {page === 'enumerator' && (
            <>
              <div className="pagehead">
                <div>
                  <div className="eyebrow">PHONE COLLECTION / ENUMERATOR</div>
                  <h1>Field questionnaire</h1>
                  <p>
                    Open a shared QR link, enter the project access code, and
                    submit your field response.
                  </p>
                </div>
                <span className="tag">
                  <Smartphone size={14} /> Phone-ready
                </span>
              </div>
              <div className="panel formpanel">
                <div className="formtitle">
                  <div className="projecticon">
                    <ClipboardList />
                  </div>
                  <div>
                    <h2>{activeProject?.title || 'Choose a questionnaire'}</h2>
                    <p>
                      {activeProject?.description ||
                        'Select a project to start collecting data.'}
                    </p>
                  </div>
                </div>
                <label className="fieldlabel">
                  Questionnaire project
                  <select
                    value={activeProject?.id || ''}
                    onChange={e => {
                      const p =
                        projects.find(x => x.id === e.target.value) || null;
                      setActiveProject(p);
                      setAnswers({});
                    }}
                  >
                    <option value="">Select project…</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="formcols">
                  <label className="fieldlabel">
                    Enumerator name / ID
                    <input
                      value={enumerator}
                      onChange={e => setEnumerator(e.target.value)}
                      placeholder="e.g. ENUM-014"
                    />
                  </label>
                  <label className="fieldlabel">
                    Project access code
                    <input
                      value={code}
                      onChange={e => setCode(e.target.value)}
                      placeholder="Enter code from supervisor"
                    />
                  </label>
                </div>
                {activeProject && (
                  <div className="questions">
                    {activeProject.questions.map((q, i) => (
                      <label className="fieldlabel question" key={q.id}>
                        <span>
                          <b>{String(i + 1).padStart(2, '0')}</b> {q.label}{' '}
                          {q.required && <em>*</em>}
                        </span>
                        {q.type === 'textarea' ? (
                          <textarea
                            value={answers[q.id] || ''}
                            onChange={e =>
                              setAnswers(a => ({
                                ...a,
                                [q.id]: e.target.value,
                              }))
                            }
                            placeholder="Type your response…"
                          />
                        ) : q.type === 'select' ? (
                          <select
                            value={answers[q.id] || ''}
                            onChange={e =>
                              setAnswers(a => ({
                                ...a,
                                [q.id]: e.target.value,
                              }))
                            }
                          >
                            <option value="">Choose an answer…</option>
                            {(q.options || []).map(o => (
                              <option key={o}>{o}</option>
                            ))}
                          </select>
                        ) : q.type === 'yesno' ? (
                          <select
                            value={answers[q.id] || ''}
                            onChange={e =>
                              setAnswers(a => ({
                                ...a,
                                [q.id]: e.target.value,
                              }))
                            }
                          >
                            <option value="">Choose…</option>
                            <option>Yes</option>
                            <option>No</option>
                          </select>
                        ) : (
                          <input
                            type={q.type === 'number' ? 'number' : 'text'}
                            value={answers[q.id] || ''}
                            onChange={e =>
                              setAnswers(a => ({
                                ...a,
                                [q.id]: e.target.value,
                              }))
                            }
                            placeholder="Enter response…"
                          />
                        )}
                      </label>
                    ))}
                  </div>
                )}
                <div className="capturegrid">
                  <div className="capturecard">
                    <div className="captureicon">
                      <MapPin />
                    </div>
                    <div>
                      <b>GPS coordinates</b>
                      <p>
                        {coords
                          ? coords.latitude + ', ' + coords.longitude
                          : 'Capture current device location'}
                      </p>
                    </div>
                    <button className="secondary" onClick={captureLocation}>
                      Capture GPS
                    </button>
                  </div>
                  <div className="capturecard">
                    <div className="captureicon">
                      <AudioLines />
                    </div>
                    <div>
                      <b>Audio evidence</b>
                      <p>{audioStatus}</p>
                    </div>
                    {recording ? (
                      <button className="dangerbtn" onClick={stopAudio}>
                        Stop recording
                      </button>
                    ) : (
                      <button className="secondary" onClick={startAudio}>
                        Record audio
                      </button>
                    )}
                  </div>
                </div>
                {audio && (
                  <div className="audioready">
                    <AudioLines size={17} /> Audio recording saved ({Math.round(audio.size / 1024)} KB). Submit this response, then upload the saved file using the interviewer link shared from Situation Room.
                  </div>
                )}
                <button
                  className="primary submitbtn"
                  disabled={busy || !activeProject}
                  onClick={submitResponse}
                >
                  {busy ? 'Submitting…' : 'Submit field response'}{' '}
                  <span>→</span>
                </button>
                <p className="privacyhint">
                  Submit only after checking answers. Location and microphone
                  are requested by your browser and require permission.
                </p>
              </div>
            </>
          )}
        </div>
      </main>
      {showCreate && (
        <div
          className="modalback"
          onMouseDown={e => {
            if (e.target === e.currentTarget) setShowCreate(false);
          }}
        >
          <div className="modal">
            <div className="modalhead">
              <div>
                <span className="eyebrow">QUESTIONNAIRE BUILDER</span>
                <h2>Create a field project</h2>
              </div>
              <button className="iconbtn" onClick={() => setShowCreate(false)}>
                <X />
              </button>
            </div>
            <label className="fieldlabel">
              Project title
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Household Survey — October 2026"
              />
            </label>
            <label className="fieldlabel">
              Description{' '}
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Purpose and field instructions"
              />
            </label>
            <div className="panelhead questionhead">
              <div>
                <h3>Questions ({questions.length})</h3>
                <p>Keep each question clear for phone enumerators.</p>
              </div>
              <button className="secondary" onClick={addQuestion}>
                <Plus size={15} /> Add question
              </button>
            </div>
            <div className="builderquestions">
              {questions.map((q, i) => (
                <div className="builderq" key={q.id}>
                  <span className="qnum">{i + 1}</span>
                  <input
                    value={q.label}
                    onChange={e =>
                      setQuestions(all =>
                        all.map(x =>
                          x.id === q.id ? { ...x, label: e.target.value } : x
                        )
                      )
                    }
                    placeholder="Write question"
                  />
                  <select
                    value={q.type}
                    onChange={e =>
                      setQuestions(all =>
                        all.map(x =>
                          x.id === q.id ? { ...x, type: e.target.value } : x
                        )
                      )
                    }
                  >
                    <option value="text">Short text</option>
                    <option value="textarea">Long text</option>
                    <option value="number">Number</option>
                    <option value="select">Multiple choice</option>
                    <option value="yesno">Yes / No</option>
                  </select>
                  <label className="requiredcheck">
                    <input
                      type="checkbox"
                      checked={!!q.required}
                      onChange={e =>
                        setQuestions(all =>
                          all.map(x =>
                            x.id === q.id
                              ? { ...x, required: e.target.checked }
                              : x
                          )
                        )
                      }
                    />{' '}
                    Required
                  </label>
                  <button
                    className="iconbtn removeq"
                    onClick={() =>
                      setQuestions(all => all.filter(x => x.id !== q.id))
                    }
                    title="Remove question"
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
            <div className="modalfoot">
              <label className="secondary uploadbtn">
                <FileUp size={15} /> Import JSON / CSV
                <input
                  type="file"
                  accept=".json,.csv"
                  onChange={e =>
                    e.target.files?.[0] && importFile(e.target.files[0])
                  }
                />
              </label>
              <button
                className="primary"
                disabled={busy}
                onClick={createProject}
              >
                {busy ? 'Saving…' : 'Save questionnaire'} <span>→</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
function SubmissionTable({
  rows,
  onReview,
  detailed = false,
}: {
  rows: Submission[];
  onReview: (s: Submission, status: string) => void;
  detailed?: boolean;
}) {
  if (!rows.length)
    return (
      <div className="empty compact">
        <b>No submissions yet</b>
        <p>
          Submitted phone responses will appear here when received by the
          server.
        </p>
      </div>
    );
  return (
    <div className="tablewrap">
      <table>
        <thead>
          <tr>
            <th>FIELD RECORD</th>
            <th>ENUMERATOR</th>
            <th>GPS LOCATION</th>
            <th>AUDIO STATUS</th>
            <th>REVIEW</th>
            {detailed && <th>SUBMITTED</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(s => (
            <tr key={s.id}>
              <td>
                <b>{s.projectTitle}</b>
                <small className="cellsub">
                  {s.id.slice(0, 12)} · {Object.keys(s.answers || {}).length}{' '}
                  answers
                </small>
                {detailed && (
                  <details>
                    <summary>View answers</summary>
                    <pre>{JSON.stringify(s.answers, null, 2)}</pre>
                  </details>
                )}
              </td>
              <td>{s.enumerator}</td>
              <td>
                {s.latitude !== undefined && s.longitude !== undefined ? (
                  <>
                    <a href={'https://maps.google.com/?q=' + s.latitude + ',' + s.longitude} target="_blank" rel="noreferrer" className="gps"><MapPin size={14} /> {s.latitude}, {s.longitude}</a>
                    {detailed && <iframe className="gpsmap" title={'Google Map for ' + s.id} loading="lazy" referrerPolicy="no-referrer-when-downgrade" src={'https://maps.google.com/maps?q=' + s.latitude + ',' + s.longitude + '&z=15&output=embed'} />}
                  </>
                ) : (
                  <span className="muted">Not captured</span>
                )}
              </td>
              <td>
                <span
                  className={
                    'badge ' + (s.audioStatus === 'Uploaded' ? 'ok' : 'pending')
                  }
                >
                  <AudioLines size={13} />
                  {s.audioStatus}
                </span>
                {s.audioUrl && <a className="audiolink" href={s.audioUrl} target="_blank" rel="noreferrer">Play / download</a>}
                {detailed && <button className="audio-share-btn" onClick={() => { const url = window.location.origin + window.location.pathname + '#audio/' + encodeURIComponent(s.id); navigator.clipboard?.writeText(url).then(() => window.alert('Audio upload link copied. Send it to the assigned interviewer.')).catch(() => window.prompt('Copy this audio upload link:', url)); }}>Copy interviewer upload link</button>}
              </td>
              <td>
                <div className="reviewcell">
                  <span
                    className={
                      'badge ' +
                      (s.reviewStatus === 'Verified'
                        ? 'ok'
                        : s.reviewStatus === 'Flagged'
                          ? 'bad'
                          : 'pending')
                    }
                  >
                    {s.reviewStatus}
                  </span>
                  <select
                    aria-label="Review status"
                    value={s.reviewStatus}
                    onChange={e => onReview(s, e.target.value)}
                  >
                    <option>Pending</option>
                    <option>Verified</option>
                    <option>Flagged</option>
                  </select>
                </div>
              </td>
              {detailed && <td>{new Date(s.submittedAt).toLocaleString()}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
