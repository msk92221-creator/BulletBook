import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App';
import { startConnection, onConnectionState, sendParent } from './connection';
import './ui/styles.css';
import './embedded.css';
function Calendar() {
  const [status, setStatus] = useState('기존 패밀리팀룸 계정으로 로그인하면 BulletBook 일정도 가족에게 공유됩니다.');
  useEffect(() => onConnectionState(setStatus), []);
  return <><header className="bulletbook-connection"><button onClick={()=>sendParent({type:'close'})}>‹ 불렛북</button><span role="status">{status}</span></header><App /></>;
}
startConnection();
createRoot(document.getElementById('root')!).render(<Calendar />);
