/**
 * DSM-5-TR diagnosis names for the ICD-10-CM codes a behavioral health practice uses most. Shown
 * next to the ICD-10-CM description (the claim always carries the ICD-10-CM code). Client-safe.
 *
 * Only codes where DSM-5-TR (2022, with the coding updates through FY2027) names one diagnosis
 * are listed; where one ICD-10-CM code covers two DSM-5-TR severities the name says so
 * ("moderate or severe"). tests/diagnosis-standard.test.ts checks every code is a billable
 * FY2027 ICD-10-CM code. Old DSM-IV / ICD-9-CM numbers (296.32 ...) are not shown: they are not
 * valid on claims since October 2015.
 */
export type DsmEntry = { code: string; name: string; group: string };

export const DSM5TR_COMMON: DsmEntry[] = [
  // Depressive disorders
  { code: 'F32.0', name: 'Major depressive disorder, single episode, mild', group: 'Depressive disorders' },
  { code: 'F32.1', name: 'Major depressive disorder, single episode, moderate', group: 'Depressive disorders' },
  { code: 'F32.2', name: 'Major depressive disorder, single episode, severe', group: 'Depressive disorders' },
  { code: 'F32.3', name: 'Major depressive disorder, single episode, with psychotic features', group: 'Depressive disorders' },
  { code: 'F32.4', name: 'Major depressive disorder, single episode, in partial remission', group: 'Depressive disorders' },
  { code: 'F32.5', name: 'Major depressive disorder, single episode, in full remission', group: 'Depressive disorders' },
  { code: 'F32.9', name: 'Major depressive disorder, single episode, unspecified', group: 'Depressive disorders' },
  { code: 'F33.0', name: 'Major depressive disorder, recurrent episode, mild', group: 'Depressive disorders' },
  { code: 'F33.1', name: 'Major depressive disorder, recurrent episode, moderate', group: 'Depressive disorders' },
  { code: 'F33.2', name: 'Major depressive disorder, recurrent episode, severe', group: 'Depressive disorders' },
  { code: 'F33.3', name: 'Major depressive disorder, recurrent episode, with psychotic features', group: 'Depressive disorders' },
  { code: 'F33.41', name: 'Major depressive disorder, recurrent episode, in partial remission', group: 'Depressive disorders' },
  { code: 'F33.42', name: 'Major depressive disorder, recurrent episode, in full remission', group: 'Depressive disorders' },
  { code: 'F33.9', name: 'Major depressive disorder, recurrent episode, unspecified', group: 'Depressive disorders' },
  { code: 'F34.1', name: 'Persistent depressive disorder', group: 'Depressive disorders' },
  { code: 'F34.81', name: 'Disruptive mood dysregulation disorder', group: 'Depressive disorders' },
  { code: 'F32.81', name: 'Premenstrual dysphoric disorder', group: 'Depressive disorders' },
  { code: 'F32.89', name: 'Other specified depressive disorder', group: 'Depressive disorders' },
  { code: 'F32.A', name: 'Unspecified depressive disorder', group: 'Depressive disorders' },
  // Bipolar and related disorders
  { code: 'F31.0', name: 'Bipolar I disorder, current or most recent episode hypomanic', group: 'Bipolar and related disorders' },
  { code: 'F31.11', name: 'Bipolar I disorder, current or most recent episode manic, mild', group: 'Bipolar and related disorders' },
  { code: 'F31.12', name: 'Bipolar I disorder, current or most recent episode manic, moderate', group: 'Bipolar and related disorders' },
  { code: 'F31.13', name: 'Bipolar I disorder, current or most recent episode manic, severe', group: 'Bipolar and related disorders' },
  { code: 'F31.2', name: 'Bipolar I disorder, current or most recent episode manic, with psychotic features', group: 'Bipolar and related disorders' },
  { code: 'F31.31', name: 'Bipolar I disorder, current or most recent episode depressed, mild', group: 'Bipolar and related disorders' },
  { code: 'F31.32', name: 'Bipolar I disorder, current or most recent episode depressed, moderate', group: 'Bipolar and related disorders' },
  { code: 'F31.4', name: 'Bipolar I disorder, current or most recent episode depressed, severe', group: 'Bipolar and related disorders' },
  { code: 'F31.5', name: 'Bipolar I disorder, current or most recent episode depressed, with psychotic features', group: 'Bipolar and related disorders' },
  { code: 'F31.73', name: 'Bipolar I disorder, current or most recent episode manic, in partial remission', group: 'Bipolar and related disorders' },
  { code: 'F31.74', name: 'Bipolar I disorder, current or most recent episode manic, in full remission', group: 'Bipolar and related disorders' },
  { code: 'F31.75', name: 'Bipolar I disorder, current or most recent episode depressed, in partial remission', group: 'Bipolar and related disorders' },
  { code: 'F31.76', name: 'Bipolar I disorder, current or most recent episode depressed, in full remission', group: 'Bipolar and related disorders' },
  { code: 'F31.81', name: 'Bipolar II disorder', group: 'Bipolar and related disorders' },
  { code: 'F34.0', name: 'Cyclothymic disorder', group: 'Bipolar and related disorders' },
  // Anxiety disorders
  { code: 'F41.1', name: 'Generalized anxiety disorder', group: 'Anxiety disorders' },
  { code: 'F41.0', name: 'Panic disorder', group: 'Anxiety disorders' },
  { code: 'F40.10', name: 'Social anxiety disorder', group: 'Anxiety disorders' },
  { code: 'F40.00', name: 'Agoraphobia', group: 'Anxiety disorders' },
  { code: 'F93.0', name: 'Separation anxiety disorder', group: 'Anxiety disorders' },
  { code: 'F94.0', name: 'Selective mutism', group: 'Anxiety disorders' },
  { code: 'F41.8', name: 'Other specified anxiety disorder', group: 'Anxiety disorders' },
  { code: 'F41.9', name: 'Unspecified anxiety disorder', group: 'Anxiety disorders' },
  // Obsessive-compulsive and related
  { code: 'F42.2', name: 'Obsessive-compulsive disorder', group: 'Obsessive-compulsive and related disorders' },
  { code: 'F42.3', name: 'Hoarding disorder', group: 'Obsessive-compulsive and related disorders' },
  { code: 'F42.4', name: 'Excoriation (skin-picking) disorder', group: 'Obsessive-compulsive and related disorders' },
  { code: 'F63.3', name: 'Trichotillomania (hair-pulling disorder)', group: 'Obsessive-compulsive and related disorders' },
  { code: 'F45.22', name: 'Body dysmorphic disorder', group: 'Obsessive-compulsive and related disorders' },
  // Trauma- and stressor-related
  { code: 'F43.10', name: 'Posttraumatic stress disorder', group: 'Trauma- and stressor-related disorders' },
  { code: 'F43.0', name: 'Acute stress disorder', group: 'Trauma- and stressor-related disorders' },
  { code: 'F43.20', name: 'Adjustment disorder, unspecified', group: 'Trauma- and stressor-related disorders' },
  { code: 'F43.21', name: 'Adjustment disorder, with depressed mood', group: 'Trauma- and stressor-related disorders' },
  { code: 'F43.22', name: 'Adjustment disorder, with anxiety', group: 'Trauma- and stressor-related disorders' },
  { code: 'F43.23', name: 'Adjustment disorder, with mixed anxiety and depressed mood', group: 'Trauma- and stressor-related disorders' },
  { code: 'F43.24', name: 'Adjustment disorder, with disturbance of conduct', group: 'Trauma- and stressor-related disorders' },
  { code: 'F43.25', name: 'Adjustment disorder, with mixed disturbance of emotions and conduct', group: 'Trauma- and stressor-related disorders' },
  { code: 'F43.81', name: 'Prolonged grief disorder', group: 'Trauma- and stressor-related disorders' },
  { code: 'F94.1', name: 'Reactive attachment disorder', group: 'Trauma- and stressor-related disorders' },
  { code: 'F94.2', name: 'Disinhibited social engagement disorder', group: 'Trauma- and stressor-related disorders' },
  // Schizophrenia spectrum
  { code: 'F20.9', name: 'Schizophrenia', group: 'Schizophrenia spectrum and other psychotic disorders' },
  { code: 'F20.81', name: 'Schizophreniform disorder', group: 'Schizophrenia spectrum and other psychotic disorders' },
  { code: 'F25.0', name: 'Schizoaffective disorder, bipolar type', group: 'Schizophrenia spectrum and other psychotic disorders' },
  { code: 'F25.1', name: 'Schizoaffective disorder, depressive type', group: 'Schizophrenia spectrum and other psychotic disorders' },
  { code: 'F22', name: 'Delusional disorder', group: 'Schizophrenia spectrum and other psychotic disorders' },
  { code: 'F23', name: 'Brief psychotic disorder', group: 'Schizophrenia spectrum and other psychotic disorders' },
  { code: 'F29', name: 'Unspecified schizophrenia spectrum and other psychotic disorder', group: 'Schizophrenia spectrum and other psychotic disorders' },
  // Neurodevelopmental
  { code: 'F90.0', name: 'Attention-deficit/hyperactivity disorder, predominantly inattentive presentation', group: 'Neurodevelopmental disorders' },
  { code: 'F90.1', name: 'Attention-deficit/hyperactivity disorder, predominantly hyperactive/impulsive presentation', group: 'Neurodevelopmental disorders' },
  { code: 'F90.2', name: 'Attention-deficit/hyperactivity disorder, combined presentation', group: 'Neurodevelopmental disorders' },
  { code: 'F90.8', name: 'Other specified attention-deficit/hyperactivity disorder', group: 'Neurodevelopmental disorders' },
  { code: 'F90.9', name: 'Unspecified attention-deficit/hyperactivity disorder', group: 'Neurodevelopmental disorders' },
  { code: 'F84.0', name: 'Autism spectrum disorder', group: 'Neurodevelopmental disorders' },
  // Disruptive, impulse-control and conduct
  { code: 'F91.3', name: 'Oppositional defiant disorder', group: 'Disruptive, impulse-control, and conduct disorders' },
  { code: 'F91.1', name: 'Conduct disorder, childhood-onset type', group: 'Disruptive, impulse-control, and conduct disorders' },
  { code: 'F91.2', name: 'Conduct disorder, adolescent-onset type', group: 'Disruptive, impulse-control, and conduct disorders' },
  { code: 'F91.9', name: 'Conduct disorder, unspecified onset', group: 'Disruptive, impulse-control, and conduct disorders' },
  { code: 'F63.81', name: 'Intermittent explosive disorder', group: 'Disruptive, impulse-control, and conduct disorders' },
  // Personality disorders
  { code: 'F60.0', name: 'Paranoid personality disorder', group: 'Personality disorders' },
  { code: 'F60.1', name: 'Schizoid personality disorder', group: 'Personality disorders' },
  { code: 'F21', name: 'Schizotypal personality disorder', group: 'Personality disorders' },
  { code: 'F60.2', name: 'Antisocial personality disorder', group: 'Personality disorders' },
  { code: 'F60.3', name: 'Borderline personality disorder', group: 'Personality disorders' },
  { code: 'F60.4', name: 'Histrionic personality disorder', group: 'Personality disorders' },
  { code: 'F60.81', name: 'Narcissistic personality disorder', group: 'Personality disorders' },
  { code: 'F60.6', name: 'Avoidant personality disorder', group: 'Personality disorders' },
  { code: 'F60.7', name: 'Dependent personality disorder', group: 'Personality disorders' },
  { code: 'F60.5', name: 'Obsessive-compulsive personality disorder', group: 'Personality disorders' },
  // Somatic, dissociative, gender
  { code: 'F45.1', name: 'Somatic symptom disorder', group: 'Somatic symptom and related disorders' },
  { code: 'F45.21', name: 'Illness anxiety disorder', group: 'Somatic symptom and related disorders' },
  { code: 'F44.81', name: 'Dissociative identity disorder', group: 'Dissociative disorders' },
  { code: 'F64.0', name: 'Gender dysphoria in adolescents and adults', group: 'Gender dysphoria' },
  { code: 'F64.2', name: 'Gender dysphoria in children', group: 'Gender dysphoria' },
  // Substance-related (42 CFR Part 2 when treated in the SUD program)
  { code: 'F10.10', name: 'Alcohol use disorder, mild', group: 'Substance-related and addictive disorders' },
  { code: 'F10.11', name: 'Alcohol use disorder, mild, in early or sustained remission', group: 'Substance-related and addictive disorders' },
  { code: 'F10.20', name: 'Alcohol use disorder, moderate or severe', group: 'Substance-related and addictive disorders' },
  { code: 'F10.21', name: 'Alcohol use disorder, moderate or severe, in early or sustained remission', group: 'Substance-related and addictive disorders' },
  { code: 'F11.10', name: 'Opioid use disorder, mild', group: 'Substance-related and addictive disorders' },
  { code: 'F11.11', name: 'Opioid use disorder, mild, in early or sustained remission', group: 'Substance-related and addictive disorders' },
  { code: 'F11.20', name: 'Opioid use disorder, moderate or severe', group: 'Substance-related and addictive disorders' },
  { code: 'F11.21', name: 'Opioid use disorder, moderate or severe, in early or sustained remission', group: 'Substance-related and addictive disorders' },
  { code: 'F12.10', name: 'Cannabis use disorder, mild', group: 'Substance-related and addictive disorders' },
  { code: 'F12.11', name: 'Cannabis use disorder, mild, in early or sustained remission', group: 'Substance-related and addictive disorders' },
  { code: 'F12.20', name: 'Cannabis use disorder, moderate or severe', group: 'Substance-related and addictive disorders' },
  { code: 'F12.21', name: 'Cannabis use disorder, moderate or severe, in early or sustained remission', group: 'Substance-related and addictive disorders' },
  { code: 'F13.10', name: 'Sedative, hypnotic, or anxiolytic use disorder, mild', group: 'Substance-related and addictive disorders' },
  { code: 'F13.20', name: 'Sedative, hypnotic, or anxiolytic use disorder, moderate or severe', group: 'Substance-related and addictive disorders' },
  { code: 'F14.10', name: 'Cocaine use disorder, mild', group: 'Substance-related and addictive disorders' },
  { code: 'F14.20', name: 'Cocaine use disorder, moderate or severe', group: 'Substance-related and addictive disorders' },
  { code: 'F15.10', name: 'Amphetamine-type substance use disorder, mild', group: 'Substance-related and addictive disorders' },
  { code: 'F15.20', name: 'Amphetamine-type substance use disorder, moderate or severe', group: 'Substance-related and addictive disorders' },
  { code: 'F17.200', name: 'Tobacco use disorder, moderate or severe', group: 'Substance-related and addictive disorders' },
  // Other conditions that may be a focus of clinical attention (Z codes)
  { code: 'Z63.0', name: 'Relationship distress with spouse or intimate partner', group: 'Other conditions (Z codes)' },
  { code: 'Z62.820', name: 'Parent-child relational problem, parent-biological child', group: 'Other conditions (Z codes)' },
  { code: 'Z63.4', name: 'Uncomplicated bereavement', group: 'Other conditions (Z codes)' },
  { code: 'Z60.0', name: 'Phase of life problem', group: 'Other conditions (Z codes)' },
];

const BY_KEY = new Map(DSM5TR_COMMON.map((e) => [e.code.replace('.', ''), e]));

/** DSM-5-TR name for an ICD-10-CM code, or null when not in the common list */
export function dsmNameFor(code: string | null | undefined): string | null {
  if (!code) return null;
  return BY_KEY.get(String(code).toUpperCase().replace(/[\s.]/g, ''))?.name ?? null;
}
