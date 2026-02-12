
import React, { useState, useEffect, useRef } from 'react';
import { ProcessState, Process, Token, Message, SimulationState } from './types';
import { Play, Pause, RotateCcw, Info, Terminal, Database, Cpu, Send, ShieldCheck, Clock, ListOrdered, BookOpen, AlertCircle } from 'lucide-react';

const NUM_PROCESSES = 5;
const NODE_RADIUS = 210;
const MESSAGE_STEP = 0.002; 

const App: React.FC = () => {
  const [state, setState] = useState<SimulationState>(() => {
    const processes: Process[] = Array.from({ length: NUM_PROCESSES }, (_, i) => ({
      id: i,
      state: ProcessState.IDLE,
      requestNumbers: new Array(NUM_PROCESSES).fill(0),
      hasToken: i === 0,
    }));

    return {
      processes,
      token: {
        queue: [],
        lastSatisfied: new Array(NUM_PROCESSES).fill(0),
      },
      messages: [],
      lastTokenHolder: 0,
    };
  });

  const [logs, setLogs] = useState<string[]>(["System initialized. P0 holds the token."]);
  const [isPaused, setIsPaused] = useState(false);
  const animationRef = useRef<number>(0);

  const addLog = (msg: string) => {
    setLogs(prev => [
      `[${new Date().toLocaleTimeString([], { hour12: false, minute: '2-digit', second: '2-digit' })}] ${msg}`, 
      ...prev
    ].slice(0, 30));
  };

  const resetSimulation = () => {
    setState({
      processes: Array.from({ length: NUM_PROCESSES }, (_, i) => ({
        id: i,
        state: ProcessState.IDLE,
        requestNumbers: new Array(NUM_PROCESSES).fill(0),
        hasToken: i === 0,
      })),
      token: {
        queue: [],
        lastSatisfied: new Array(NUM_PROCESSES).fill(0),
      },
      messages: [],
      lastTokenHolder: 0,
    });
    setLogs(["Simulation reset. P0 re-initialized with the token."]);
  };

  const handleRequestCS = (pid: number) => {
    setState(prev => {
      const p = prev.processes[pid];
      if (p.state !== ProcessState.IDLE || p.hasToken) return prev;

      const newProcesses = prev.processes.map(proc => {
        if (proc.id === pid) {
          const nextRN = [...proc.requestNumbers];
          nextRN[pid] += 1;
          return { ...proc, state: ProcessState.REQUESTING, requestNumbers: nextRN };
        }
        return proc;
      });

      const sn = newProcesses[pid].requestNumbers[pid];
      addLog(`P${pid} requests CS. Tuple: (P${pid}, SN:${sn}). Broadcasting.`);

      const newMessages: Message[] = [];
      for (let i = 0; i < NUM_PROCESSES; i++) {
        if (i !== pid) {
          newMessages.push({
            id: `req-${pid}-${i}-${Date.now()}-${Math.random()}`,
            from: pid,
            to: i,
            type: 'REQUEST',
            payload: { sender: pid, sn },
            progress: 0,
          });
        }
      }

      return {
        ...prev,
        processes: newProcesses,
        messages: [...prev.messages, ...newMessages],
      };
    });
  };

  const handleFinishCS = (pid: number) => {
    setState(prev => {
      if (!prev.token) return prev;
      
      const p = prev.processes[pid];
      if (p.state !== ProcessState.EXECUTING) return prev;

      addLog(`P${pid} releasing CS. Updating Token and checking Queue.`);

      const newToken = { ...prev.token };
      newToken.lastSatisfied[pid] = p.requestNumbers[pid];

      const currentQueue = [...newToken.queue];
      for (let j = 0; j < NUM_PROCESSES; j++) {
        if (!currentQueue.includes(j) && p.requestNumbers[j] === newToken.lastSatisfied[j] + 1) {
          currentQueue.push(j);
        }
      }
      newToken.queue = currentQueue;
      
      const newProcesses = prev.processes.map(proc => 
        proc.id === pid ? { ...proc, state: ProcessState.IDLE } : proc
      );

      if (newToken.queue.length > 0) {
        const nextPid = newToken.queue.shift()!;
        newToken.queue = [...newToken.queue];
        
        addLog(`Popping P${nextPid} from Token Queue. Sending Token.`);
        
        const tokenMsg: Message = {
          id: `token-${pid}-${nextPid}-${Date.now()}`,
          from: pid,
          to: nextPid,
          type: 'TOKEN',
          payload: { token: newToken },
          progress: 0,
        };

        return {
          ...prev,
          processes: newProcesses.map(pr => pr.id === pid ? { ...pr, hasToken: false } : pr),
          token: null,
          messages: [...prev.messages, tokenMsg],
        };
      }

      return { ...prev, processes: newProcesses, token: newToken };
    });
  };

  const processArrivedMessage = (state: SimulationState, msg: Message): SimulationState => {
    const newProcesses = [...state.processes];
    const receiver = { ...newProcesses[msg.to] };
    let newToken = state.token ? { ...state.token } : null;
    let newMessages = state.messages.filter(m => m.id !== msg.id);
    let newLastTokenHolder = state.lastTokenHolder;

    if (msg.type === 'REQUEST') {
      const { sender, sn } = msg.payload;
      receiver.requestNumbers[sender] = Math.max(receiver.requestNumbers[sender], sn);

      if (receiver.hasToken && receiver.state === ProcessState.IDLE && newToken) {
        if (receiver.requestNumbers[sender] === newToken.lastSatisfied[sender] + 1) {
          addLog(`P${msg.to} satisfies request (P${sender}, SN:${sn}). Transferring Token.`);
          receiver.hasToken = false;
          const tokenMsg: Message = {
            id: `token-${msg.to}-${sender}-${Date.now()}`,
            from: msg.to,
            to: sender,
            type: 'TOKEN',
            payload: { token: newToken },
            progress: 0,
          };
          newMessages.push(tokenMsg);
          newToken = null;
        }
      }
    } else if (msg.type === 'TOKEN') {
      addLog(`P${msg.to} received Token. Entering Critical Section.`);
      receiver.hasToken = true;
      receiver.state = ProcessState.EXECUTING;
      newToken = msg.payload.token;
      newLastTokenHolder = msg.to;
    }

    newProcesses[msg.to] = receiver;
    return {
      ...state,
      processes: newProcesses,
      token: newToken,
      messages: newMessages,
      lastTokenHolder: newLastTokenHolder,
    };
  };

  useEffect(() => {
    if (isPaused) return;

    const tick = () => {
      setState(prev => {
        const nextMessages = prev.messages.map(m => ({
          ...m,
          progress: m.progress + MESSAGE_STEP,
        }));

        const arrived = nextMessages.filter(m => m.progress >= 1);
        if (arrived.length === 0) {
          return { ...prev, messages: nextMessages };
        }

        const first = arrived[0];
        return processArrivedMessage({ ...prev, messages: nextMessages }, first);
      });
      animationRef.current = requestAnimationFrame(tick);
    };

    animationRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationRef.current);
  }, [isPaused]);

  const getNodePos = (i: number) => {
    const angle = (i / NUM_PROCESSES) * 2 * Math.PI - Math.PI / 2;
    return {
      x: 350 + Math.cos(angle) * NODE_RADIUS,
      y: 350 + Math.sin(angle) * NODE_RADIUS,
    };
  };

  return (
    <div className="flex flex-col h-screen bg-[#05080f] text-slate-200 overflow-hidden font-sans select-none">
      {/* Header */}
      <header className="h-14 border-b border-white/5 bg-slate-900/40 backdrop-blur-2xl flex items-center justify-between px-8 shrink-0 z-50 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/20 border border-white/10">
            <Cpu className="text-white" size={22} />
          </div>
          <div>
            <h1 className="text-xs font-black tracking-[0.2em] text-white uppercase italic">Suzuki-Kasami Distributed Mutual Exclusion</h1>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsPaused(!isPaused)}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 border border-white/5 rounded-xl flex items-center gap-3 transition-all text-[10px] font-black tracking-widest shadow-xl"
          >
            {isPaused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
            {isPaused ? "RESUME" : "PAUSE"}
          </button>
          <button 
            onClick={resetSimulation}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 border border-white/5 rounded-xl flex items-center gap-3 transition-all text-[10px] font-black tracking-widest shadow-xl"
          >
            <RotateCcw size={14} />
            RESET
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-[340px] border-r border-white/5 bg-slate-900/10 flex flex-col shrink-0 overflow-y-auto custom-scrollbar">
          <div className="p-6 space-y-8">
            <section>
              <h2 className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-3">
                <BookOpen size={14} /> Protocol Mechanics
              </h2>
              <div className="space-y-4 text-[11px] leading-relaxed text-slate-500 font-medium">
                <p>When a node requests the token, it broadcasts a tuple <span className="text-white bg-white/5 px-1.5 py-0.5 rounded">(Node ID, Seq Num)</span>.</p>
                
                <div className="p-4 bg-indigo-500/5 rounded-2xl border border-white/5 space-y-2">
                  <h3 className="font-black text-slate-300 text-[9px] uppercase flex items-center gap-2">
                    <Database size={12} className="text-indigo-400" /> RN Array (Requester Knowledge)
                  </h3>
                  <p>Nodes store the highest known sequence number for every peer in their local <strong>RN array</strong>.</p>
                </div>

                <div className="p-4 bg-emerald-500/5 rounded-2xl border border-white/5 space-y-2">
                  <h3 className="font-black text-slate-300 text-[9px] uppercase flex items-center gap-2">
                    <ShieldCheck size={12} className="text-emerald-400" /> Token (Authority)
                  </h3>
                  <p>The token contains <strong>LN array</strong> (last satisfied) and a <strong>Queue</strong> of nodes waiting for the CS.</p>
                </div>
              </div>
            </section>

            <section>
              <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-3">
                <Terminal size={14} /> Protocol Trace
              </h2>
              <div className="h-56 bg-black/40 rounded-2xl border border-white/5 p-4 font-mono text-[9px] overflow-y-auto custom-scrollbar shadow-inner">
                {logs.map((log, i) => (
                  <div key={i} className={`mb-2 leading-tight ${i === 0 ? 'text-indigo-300' : 'text-slate-600'}`}>
                    {log}
                  </div>
                ))}
              </div>
            </section>
          </div>
        </aside>

        {/* Main Canvas */}
        <main className="flex-1 relative flex items-center justify-center p-8 bg-[#05080f]">
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
            style={{ backgroundImage: 'radial-gradient(#4f46e5 1px, transparent 1px)', backgroundSize: '60px 60px' }}
          />
          
          <div className="relative w-[700px] h-[700px]">
            <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
              <defs>
                <filter id="msg-glow">
                  <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                  <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
              </defs>

              <circle cx="350" cy="350" r={NODE_RADIUS} fill="none" stroke="rgba(255, 255, 255, 0.02)" strokeWidth="1" strokeDasharray="10 10" />

              {state.messages.map(msg => {
                const start = getNodePos(msg.from);
                const end = getNodePos(msg.to);
                const x = start.x + (end.x - start.x) * msg.progress;
                const y = start.y + (end.y - start.y) * msg.progress;
                const isToken = msg.type === 'TOKEN';

                return (
                  <g key={msg.id}>
                    <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={isToken ? "#10b98115" : "#f59e0b10"} strokeWidth="1" />
                    <circle 
                      cx={x} cy={y} 
                      r={isToken ? 12 : 7} 
                      fill={isToken ? "#10b981" : "#f59e0b"} 
                      filter="url(#msg-glow)"
                    />
                    <g transform={`translate(${x}, ${y - 18})`}>
                      <rect x="-35" y="-10" width="70" height="18" rx="6" fill="rgba(10, 15, 30, 0.98)" className="stroke-white/10" />
                      <text textAnchor="middle" y="2" className={`text-[8px] font-black tracking-widest ${isToken ? 'fill-emerald-400' : 'fill-amber-400'}`}>
                        {isToken ? "TOKEN" : `(P${msg.payload.sender}, SN:${msg.payload.sn})`}
                      </text>
                    </g>
                  </g>
                );
              })}
            </svg>

            {/* Nodes */}
            {state.processes.map((p, i) => {
              const pos = getNodePos(i);
              const isExecuting = p.state === ProcessState.EXECUTING;
              const isRequesting = p.state === ProcessState.REQUESTING;

              return (
                <div 
                  key={p.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2 group z-30"
                  style={{ left: pos.x, top: pos.y }}
                >
                  <div className={`
                    w-28 h-28 rounded-[2rem] flex flex-col items-center justify-center transition-all duration-700 relative border
                    ${isExecuting ? 'bg-emerald-600/5 border-emerald-500/60 shadow-[0_0_40px_rgba(16,185,129,0.2)]' : 
                      isRequesting ? 'bg-amber-600/5 border-amber-500/60' : 
                      'bg-slate-900/90 border-white/5'}
                  `}>
                    <span className="text-[10px] font-black text-slate-600 tracking-[0.2em] mb-1">PROCESS {p.id}</span>
                    <div className="flex gap-2">
                      {isExecuting ? <Clock size={18} className="text-emerald-400 animate-pulse" /> : 
                       isRequesting ? <RotateCcw size={18} className="text-amber-500 animate-spin-slow" /> : 
                       <Cpu size={18} className="text-slate-800" />}
                    </div>

                    {p.hasToken && (
                      <div className="absolute -top-2 -right-2 bg-emerald-500 text-white p-1.5 rounded-xl shadow-2xl animate-bounce border border-emerald-400">
                        <Database size={12} fill="white" />
                      </div>
                    )}

                    {/* Local RN Table - Slightly bigger as requested */}
                    <div className="mt-3 flex gap-1 px-1.5 py-1 bg-black/60 rounded-xl border border-white/5">
                      {p.requestNumbers.map((val, idx) => (
                        <div key={idx} className="flex flex-col items-center min-w-[15px]">
                          <span className="text-[7px] text-slate-700 font-black">P{idx}</span>
                          <span className={`text-[10px] font-mono font-black ${val > 0 ? 'text-indigo-400' : 'text-slate-800'}`}>{val}</span>
                        </div>
                      ))}
                    </div>

                    {/* Interaction UI */}
                    <div className="absolute inset-0 bg-slate-950/98 flex flex-col items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-all rounded-[2rem] p-3 border border-indigo-500/20 backdrop-blur-sm">
                      {p.state === ProcessState.IDLE && !p.hasToken && (
                        <button 
                          onClick={() => handleRequestCS(p.id)}
                          className="w-full py-2.5 text-[9px] font-black text-white bg-indigo-600 hover:bg-indigo-500 rounded-xl uppercase tracking-widest shadow-lg shadow-indigo-500/20"
                        >
                          Request
                        </button>
                      )}
                      {isExecuting && (
                        <button 
                          onClick={() => handleFinishCS(p.id)}
                          className="w-full py-2.5 text-[9px] font-black text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl uppercase tracking-widest shadow-lg shadow-emerald-500/20"
                        >
                          Release
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Global Token HUD - Shrunk as requested */}
            {state.token && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-56 bg-slate-900/60 border border-emerald-500/10 rounded-[2.5rem] p-5 shadow-2xl backdrop-blur-3xl ring-1 ring-white/5">
                <div className="flex items-center gap-2 mb-5 text-emerald-400/80">
                  <Database size={14} />
                  <span className="text-[8px] font-black uppercase tracking-[0.4em]">Token Metadata</span>
                </div>
                
                <div className="space-y-5">
                  <div>
                    <div className="text-[7px] font-black text-slate-600 uppercase tracking-widest mb-2 px-1">LN Array (Satisfied Requests)</div>
                    <div className="flex gap-1.5 justify-center">
                      {state.token.lastSatisfied.map((v, i) => (
                        <div key={i} className="flex flex-col items-center">
                           <span className="text-[6px] text-slate-800 mb-0.5 font-bold">P{i}</span>
                           <div className="w-7 h-7 rounded-lg bg-emerald-500/5 border border-emerald-500/10 flex items-center justify-center text-[10px] font-mono font-black text-emerald-400">
                            {v}
                           </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="text-[7px] font-black text-slate-600 uppercase tracking-widest mb-2 px-1 flex justify-between">
                      <span>Request Queue</span>
                      <span className="opacity-50">({state.token.queue.length})</span>
                    </div>
                    <div className="min-h-[34px] bg-black/40 border border-white/5 rounded-2xl p-1.5 flex gap-1 flex-wrap items-center justify-center shadow-inner">
                      {state.token.queue.length > 0 ? (
                        state.token.queue.map((pid, idx) => (
                          <div key={idx} className="flex items-center">
                            <span className="bg-indigo-600 text-white text-[9px] font-black px-2 py-0.5 rounded-md shadow-lg">P{pid}</span>
                            {idx < state.token!.queue.length - 1 && <div className="mx-0.5 text-slate-800 text-[8px]">→</div>}
                          </div>
                        ))
                      ) : (
                        <span className="text-[7px] text-slate-800 italic font-bold tracking-widest py-1 uppercase">Queue Empty</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-white/5 flex items-center justify-center gap-2 text-slate-600">
                   <ShieldCheck size={10} />
                   <span className="text-[7px] font-black uppercase tracking-widest opacity-60">Locked: Process P{state.lastTokenHolder}</span>
                </div>
              </div>
            )}

            {!state.token && (
               <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center">
                  <div className="w-14 h-14 bg-indigo-500/5 rounded-[1.8rem] border border-indigo-500/20 flex items-center justify-center shadow-2xl">
                    <Send className="text-indigo-400/60 animate-pulse" size={20} />
                    <div className="absolute -inset-1 rounded-[1.8rem] border border-indigo-500/10 animate-ping opacity-10" />
                  </div>
                  <span className="text-[7px] font-black text-indigo-500/40 mt-4 tracking-[0.4em] uppercase animate-pulse italic">Transferring Token</span>
               </div>
            )}
          </div>
        </main>
      </div>

      <footer className="h-10 bg-black border-t border-white/5 flex items-center justify-center gap-10 px-8 text-[8px] font-black uppercase tracking-[0.3em] text-slate-700">
        <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-sm bg-slate-900 border border-white/10" /><span>Idle</span></div>
        <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-sm bg-amber-500/50 shadow-[0_0_8px_rgba(245,158,11,0.3)]" /><span>Requesting</span></div>
        <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-sm bg-emerald-500/50 shadow-[0_0_8px_rgba(16,185,129,0.3)]" /><span>In CS</span></div>
        <div className="flex items-center gap-2"><Database size={10} className="text-emerald-500/40" /><span>Token Authority</span></div>
      </footer>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.05); border-radius: 10px; }
        @keyframes spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin-slow { animation: spin-slow 18s linear infinite; }
      `}</style>
    </div>
  );
};

export default App;
